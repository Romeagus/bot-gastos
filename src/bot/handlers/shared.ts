/**
 * Utilidades compartidas por los handlers de Telegram.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/shared.ts
 *
 * Evita duplicar entre handlers el alta de usuario y el flujo comun
 * "texto interpretado -> gasto persistido -> respuesta".
 */

import type { Context } from 'telegraf';
import { env } from '../../config/env.js';
import type { ParsedExpense } from '../../domain/schemas/parsed-expense.schema.js';
import type { ExpenseSourceType } from '../../domain/types/expense.js';
import type { User } from '../../domain/types/user.js';
import { upsertByTelegramId } from '../../db/repositories/users.repo.js';
import { parseExpenseFromText } from '../../services/ai/reasoning.service.js';
import { evaluateBudgetAlert } from '../../services/budgets.service.js';
import { createExpenseFromParsed } from '../../services/expenses.service.js';
import { formatAmount } from '../../utils/format.js';

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
    category === null ? 'Sin categoria' : `${category.emoji ?? ''} ${category.name}`.trim();
  await ctx.reply(`Anote ${formatAmount(expense.amount, expense.currency)} en ${label}.`);

  // Alerta preventiva de presupuesto (si corresponde).
  const alert = await evaluateBudgetAlert(expense);
  if (alert !== null) {
    await ctx.reply(alert);
  }
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
  });

  if (parsed === null) {
    return false;
  }

  await replyExpense(ctx, user, parsed, sourceType, text, env.REASONING_MODEL, telegramMessageId);
  return true;
}
