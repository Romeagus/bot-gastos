/**
 * Utilidades compartidas por los handlers de Telegram.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/shared.ts
 *
 * Evita duplicar entre handlers el alta de usuario y el flujo comun
 * "texto interpretado -> gasto persistido -> respuesta".
 */

import { Input, Markup, type Context } from 'telegraf';
import { env } from '../../config/env.js';
import type { ParsedExpense } from '../../domain/schemas/parsed-expense.schema.js';
import type { Expense, ExpenseSourceType } from '../../domain/types/expense.js';
import type { User } from '../../domain/types/user.js';
import { findForUserBySlug } from '../../db/repositories/categories.repo.js';
import { upsertByTelegramId } from '../../db/repositories/users.repo.js';
import { splitInstructions } from '../../services/ai/instructions.service.js';
import { parseExpenseFromText } from '../../services/ai/reasoning.service.js';
import type { Answer } from '../../services/answer.js';
import { evaluateBudgetAlert } from '../../services/budgets.service.js';
import {
  availableCategorySlugs,
  listAvailableCategories,
} from '../../services/categories.service.js';
import {
  createExpenseFromParsed,
  editExpenseAmount,
  editExpenseCategory,
} from '../../services/expenses.service.js';
import { handleRequest } from '../../services/queries.service.js';
import { formatMoney } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import {
  isBudgetRequest,
  isCategoryRequest,
  isExportRequest,
  parseMoneyPhrase,
  resolveCategorySlug,
  slugifyCategory,
} from '../../utils/nlp.js';
import { takePendingEdit, type PendingEdit } from '../pending-edit.js';

const log = createLogger('bot:shared');

/**
 * Confianza minima para anotar un gasto sin preguntar.
 *
 * Los gastos claros vuelven con 0.98-0.99 y una salida mal formada cae a 0.5
 * (el valor por defecto del esquema), asi que 0.7 separa bien los dos casos.
 * Debajo de este umbral se pide confirmacion: una transcripcion de audio mal
 * interpretada podria crear un gasto que el usuario nunca quiso.
 */
const CONFIDENCE_THRESHOLD = 0.7;

/** Da de alta o actualiza al usuario que envio el mensaje. */
export async function resolveUser(ctx: Context): Promise<User | null> {
  const from = ctx.from;
  if (from === undefined) {
    return null;
  }

  return upsertByTelegramId({
    telegramId: from.id,
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    languageCode: from.language_code ?? null,
  });
}

/**
 * Interpreta un texto y, si describe un gasto, lo persiste y responde.
 *
 * @returns `true` si se registro un gasto; `false` si el texto no era un gasto.
 */
export async function replyExpense(
  ctx: Context,
  user: User,
  parsed: ParsedExpense,
  sourceType: ExpenseSourceType,
  rawInput: string,
  aiModel: string,
  telegramMessageId: number | null,
): Promise<void> {
  const { expense, category } = await createExpenseFromParsed({
    user,
    parsed,
    sourceType,
    rawInput,
    aiModel,
    telegramMessageId,
  });

  const label =
    category === null ? 'Sin categoría' : `${category.emoji ?? ''} ${category.name}`.trim();
  await ctx.reply(`✅ Listo, anoté ${formatMoney(expense.amount, expense.currency)} en ${label}`);

  // Alerta preventiva de presupuesto (si corresponde).
  const alert = await evaluateBudgetAlert(expense);
  if (alert !== null) {
    await ctx.reply(alert);
  }
}

/**
 * Rutea un texto libre (escrito o transcripto de un audio).
 *
 * Un MISMO mensaje puede traer varias instrucciones (tipico en audio: "gasté
 * 3500 en el super y cuánto llevo este mes"): se parten y se resuelven una por
 * una. Si el modelo no puede separarlas, se trata como una sola.
 *
 * Tambien intercepta la respuesta a una edicion pendiente ("¿cuál es el monto
 * nuevo?"): en ese caso el texto ES el valor a aplicar, no una instruccion.
 */
export async function handleFreeText(
  ctx: Context,
  user: User,
  text: string,
  sourceType: ExpenseSourceType,
  telegramMessageId: number | null,
  /** Texto transcripto: se muestra solo si NO pudimos interpretarlo (audio). */
  heardText?: string,
): Promise<void> {
  // Si el usuario venia de tocar "cambiar el monto/categoría", este mensaje es
  // el valor nuevo.
  const pending = takePendingEdit(user.id);
  if (pending !== null) {
    await applyPendingEdit(ctx, user, pending, text);
    return;
  }

  const segments = await splitInstructions(text);

  if (segments.length <= 1) {
    await handleInstruction(ctx, user, text, sourceType, telegramMessageId, heardText);
    return;
  }

  if (heardText !== undefined) {
    await ctx.reply(`🎙️ Te escuché: «${heardText}»\nVoy con ${segments.length} cosas 👇`);
  }

  // Solo la PRIMERA instruccion conserva el id del mensaje: el indice unico
  // (user_id, telegram_message_id) no admite dos gastos del mismo mensaje, y asi
  // un reintento de Telegram no duplica el primero.
  let index = 0;
  for (const segment of segments) {
    await handleInstruction(
      ctx,
      user,
      segment,
      sourceType,
      index === 0 ? telegramMessageId : null,
      undefined,
    );
    index += 1;
  }
}

/** Resuelve UNA instruccion: gasto, o consulta / presupuesto / categoria. */
async function handleInstruction(
  ctx: Context,
  user: User,
  text: string,
  sourceType: ExpenseSourceType,
  telegramMessageId: number | null,
  heardText?: string,
): Promise<void> {
  // Un pedido de presupuesto, de categoria o de exportacion NO es un gasto, aunque
  // mencione un monto o una categoria: lo resolvemos por el camino conversacional.
  // Sin este filtro, "pasame el csv de los gastos" podria anotarse como un gasto.
  const isConversational =
    isBudgetRequest(text) || isCategoryRequest(text) || isExportRequest(text);

  if (!isConversational) {
    const registered = await logExpenseFromText(ctx, user, text, sourceType, telegramMessageId);
    if (registered) {
      return;
    }
  }

  const answer = await handleRequest(user, text);
  if (answer !== null) {
    await replyAnswer(ctx, answer);
    return;
  }

  await ctx.reply(
    heardText === undefined ? UNKNOWN_TEXT : `🎙️ Te escuché: «${heardText}»\n\n${UNKNOWN_TEXT}`,
  );
}

/**
 * Responde un `Answer`, convirtiendo sus botones en un teclado y sus documentos
 * en un archivo adjunto.
 */
export async function replyAnswer(ctx: Context, answer: Answer): Promise<void> {
  // El archivo tiene prioridad: en Telegram un mensaje con teclado inline y un
  // documento a la vez se renderiza mal, asi que van por separado.
  if (answer.document !== undefined) {
    const { filename, content } = answer.document;
    await ctx.replyWithDocument(Input.fromBuffer(content, filename), {
      caption: answer.text,
      // React: no deja "enviar" el archivo y confunde con los botones de borrar.
      disable_notification: true,
    });
    return;
  }

  if (answer.buttons === undefined) {
    await ctx.reply(answer.text);
    return;
  }

  const rows = answer.buttons.map((row) =>
    row.map((item) => Markup.button.callback(item.text, item.data)),
  );
  await ctx.reply(answer.text, Markup.inlineKeyboard(rows));
}

/** Aplica la edicion pendiente con el texto que mando el usuario. */
async function applyPendingEdit(
  ctx: Context,
  user: User,
  pending: PendingEdit,
  text: string,
): Promise<void> {
  if (pending.field === 'amount') {
    // El monto se parsea en codigo, no con IA: es un numero y no hace falta
    // gastar una llamada al modelo.
    const amount = parseMoneyPhrase(text);
    if (amount === null || amount <= 0) {
      await ctx.reply('No te entendí el monto 😅 Tocá /editar y probamos de nuevo.');
      return;
    }

    const result = await editExpenseAmount(user.id, pending.expenseId, amount);
    await ctx.reply(
      result.edited && result.expense !== null
        ? `✅ Corregido: ahora son ${formatMoney(result.expense.amount, result.expense.currency)}.`
        : (result.reason ?? 'No pude editar el gasto.'),
    );
    return;
  }

  // Categoria: se resuelve con los alias y con las categorias propias.
  const slug = resolveCategorySlug(text) ?? slugifyCategory(text);
  const category = slug === null ? null : await findForUserBySlug(user.id, slug);

  if (category === null) {
    const categories = await listAvailableCategories(user.id);
    await ctx.reply(
      [
        `No tengo ninguna categoría "${text}" 🤔`,
        `Tengo: ${categories.map((item) => item.slug).join(', ')}.`,
      ].join('\n'),
    );
    return;
  }

  const result = await editExpenseCategory(user.id, pending.expenseId, category.id);
  const label = `${category.emoji ?? ''} ${category.name}`.trim();
  await ctx.reply(
    result.edited
      ? `✅ Corregido: ahora está en ${label}.`
      : (result.reason ?? 'No pude editar el gasto.'),
  );
}

/** Texto accionable cuando el mensaje no es ni un gasto ni algo que sepamos responder. */
export const UNKNOWN_TEXT = [
  'Mmm, no te entendí 🤔 Probá con algo de esto:',
  '',
  '• "gasté 3500 en el super"',
  '• "cuánto gasté este mes"',
  '• "presupuesto de 50 lucas en super"',
  '• "creá la categoría gimnasio"',
].join('\n');

/**
 * Registra un gasto como PENDIENTE y pide confirmacion con botones.
 *
 * Se usa en dos casos: la foto de un ticket (la IA puede leer mal el monto) y un
 * gasto interpretado con BAJA confianza (tipico de una transcripcion de audio
 * confusa). En ambos, nada queda confirmado sin que la persona lo valide.
 *
 * Se guarda con estado `pending` en la base en lugar de guardarlo en memoria: si
 * el bot se reinicia entre el mensaje y el toque del boton, el gasto sigue estando.
 *
 * @returns El gasto creado, para poder diagnosticar desde el handler.
 */
export async function replyExpensePending(
  ctx: Context,
  user: User,
  parsed: ParsedExpense,
  sourceType: ExpenseSourceType,
  rawInput: string,
  aiModel: string,
  telegramMessageId: number | null,
): Promise<Expense> {
  const { expense, category } = await createExpenseFromParsed({
    user,
    parsed,
    sourceType,
    rawInput,
    aiModel,
    telegramMessageId,
    status: 'pending',
  });

  const label =
    category === null ? 'Sin categoría' : `${category.emoji ?? ''} ${category.name}`.trim();
  const detail = [expense.merchant, expense.description]
    .filter((value) => value !== null && value !== '')
    .join(' · ');

  const lines = [
    '🤔 Esto entendí:',
    '',
    `💸 ${formatMoney(expense.amount, expense.currency)} en ${label}`,
  ];
  if (detail !== '') {
    lines.push(`🏪 ${detail}`);
  }
  lines.push('', '¿Lo anoto?');

  await ctx.reply(
    lines.join('\n'),
    Markup.inlineKeyboard([
      Markup.button.callback('✅ Sí', `exp:${expense.id}:y`),
      Markup.button.callback('❌ No', `exp:${expense.id}:n`),
    ]),
  );

  return expense;
}

/**
 * Interpreta un texto y, si describe un gasto, lo registra y responde.
 *
 * Con confianza BAJA no se anota de una: se guarda como pendiente y se pide
 * confirmacion. Es la red de seguridad contra una transcripcion de audio mal
 * interpretada, que crearia un gasto que el usuario nunca quiso.
 *
 * @returns `true` si se registro (o se dejo pendiente) un gasto; `false` si el
 *          texto no era un gasto.
 */
export async function logExpenseFromText(
  ctx: Context,
  user: User,
  text: string,
  sourceType: ExpenseSourceType,
  telegramMessageId: number | null,
): Promise<boolean> {
  const parsed = await parseExpenseFromText({
    text,
    today: new Date().toISOString().slice(0, 10),
    defaultCurrency: user.currency,
    // Se le ofrecen al modelo las categorias reales del usuario (incluidas las
    // propias) para que clasifique solo con opciones que existen.
    categorySlugs: await availableCategorySlugs(user.id),
  });

  if (parsed === null) {
    return false;
  }

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    log.warn('Extraccion con baja confianza: se pide confirmacion', {
      confidence: parsed.confidence,
      sourceType,
      text,
    });

    if (telegramMessageId !== null) {
      await replyExpensePending(
        ctx,
        user,
        parsed,
        sourceType,
        text,
        env.REASONING_MODEL,
        telegramMessageId,
      );
      return true;
    }

    // Sin id de mensaje (2do o posterior segmento de un mensaje multiple) no se
    // puede usar el flujo pendiente, que se apoya en el indice unico de Telegram.
    await ctx.reply(
      [
        `🤔 No estoy seguro de haber entendido esto: «${text}»`,
        'Mandámelo solo, en un mensaje aparte, y te lo confirmo.',
      ].join('\n'),
    );
    return true;
  }

  await replyExpense(ctx, user, parsed, sourceType, text, env.REASONING_MODEL, telegramMessageId);
  return true;
}
