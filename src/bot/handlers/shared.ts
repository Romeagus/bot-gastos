/**
 * Utilidades compartidas por los handlers de Telegram.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/shared.ts
 *
 * Evita duplicar entre handlers el alta de usuario y el flujo comun
 * "texto interpretado -> gasto persistido -> respuesta".
 */

import { Markup, type Context } from 'telegraf';
import { env } from '../../config/env.js';
import type { ParsedExpense } from '../../domain/schemas/parsed-expense.schema.js';
import type { Expense, ExpenseSourceType } from '../../domain/types/expense.js';
import type { User } from '../../domain/types/user.js';
import { upsertByTelegramId } from '../../db/repositories/users.repo.js';
import { parseExpenseFromText } from '../../services/ai/reasoning.service.js';
import { evaluateBudgetAlert } from '../../services/budgets.service.js';
import { availableCategorySlugs } from '../../services/categories.service.js';
import { createExpenseFromParsed } from '../../services/expenses.service.js';
import { handleRequest } from '../../services/queries.service.js';
import { formatMoney } from '../../utils/format.js';
import { isBudgetRequest, isCategoryRequest } from '../../utils/nlp.js';

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
  telegramMessageId: number,
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
 * Rutea un texto libre (escrito o transcripto de un audio):
 *   1. si es un gasto -> lo registra;
 *   2. si no -> lo interpreta como consulta, presupuesto o categoria;
 *   3. si no entiende nada -> pide que reformule.
 *
 * Es el punto de entrada comun de los handlers de texto y de audio, asi ambos
 * canales entienden exactamente lo mismo.
 */
export async function handleFreeText(
  ctx: Context,
  user: User,
  text: string,
  sourceType: ExpenseSourceType,
  telegramMessageId: number,
  /** Texto transcripto: se muestra solo si NO pudimos interpretarlo (audio). */
  heardText?: string,
): Promise<void> {
  // Un pedido de presupuesto o de categoria NO es un gasto, aunque mencione un
  // monto o una categoria: lo resolvemos por el camino conversacional.
  const isConversational = isBudgetRequest(text) || isCategoryRequest(text);

  if (!isConversational) {
    const registered = await logExpenseFromText(ctx, user, text, sourceType, telegramMessageId);
    if (registered) {
      return;
    }
  }

  const answer = await handleRequest(user, text);
  if (answer !== null) {
    await ctx.reply(answer);
    return;
  }

  await ctx.reply(
    heardText === undefined ? UNKNOWN_TEXT : `🎙️ Te escuché: «${heardText}»\n\n${UNKNOWN_TEXT}`,
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
 * Se usa en el flujo de foto de ticket: la IA puede leer mal el monto (o no ser
 * un ticket), asi que nada queda confirmado sin que la persona lo valide. Se
 * guarda con estado `pending` en la base en lugar de guardarlo en memoria: si
 * el bot se reinicia entre la foto y el toque del boton, el gasto sigue estando.
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
  telegramMessageId: number,
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
    '🧾 Leí el ticket:',
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
 * @returns `true` si se registro un gasto; `false` si el texto no era un gasto.
 */
export async function logExpenseFromText(
  ctx: Context,
  user: User,
  text: string,
  sourceType: ExpenseSourceType,
  telegramMessageId: number,
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

  await replyExpense(ctx, user, parsed, sourceType, text, env.REASONING_MODEL, telegramMessageId);
  return true;
}
