/**
 * Handler de gestion de gastos: /borrar y /reset.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/manage.handler.ts
 *
 * Son las dos operaciones destructivas del bot, asi que van por COMANDO y
 * siempre piden confirmacion con botones: nunca se borra nada a partir de un
 * mensaje suelto que el bot podria haber malinterpretado.
 *
 * El borrado es LOGICO (`status = 'rejected'`): el gasto desaparece de totales,
 * topes y listados, y la fila queda en la base por si hay que recuperarla.
 *
 * callback_data:
 *   del:<uuid>  -> borra ese gasto
 *   reset:ask   -> pide confirmacion para borrar todo
 *   reset:exp   -> borra solo los gastos
 *   reset:all   -> borra gastos y topes
 *   reset:no    -> cancela
 *   mng:close   -> cierra el menu
 */

import { Markup, type Context, type Telegraf } from 'telegraf';
import type { Expense } from '../../domain/types/expense.js';
import type { User } from '../../domain/types/user.js';
import { clearAllBudgets } from '../../services/budgets.service.js';
import { categoryLabelMap } from '../../services/categories.service.js';
import {
  clearAllExpenses,
  deleteExpense,
  getExpenseSummary,
  listRecentExpenses,
} from '../../services/expenses.service.js';
import { formatMoney, formatShortDate } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:manage');

/** Cuantos gastos se ofrecen para borrar de a uno. */
const DELETE_MENU_SIZE = 5;

/** Recorta un texto para que entre comodo en un boton. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Pluraliza de forma simple: '1 movimiento' / '2 movimientos'. */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Texto del boton que identifica al gasto que se va a borrar. */
function deleteButtonLabel(expense: Expense, labels: Map<string, string>): string {
  const name =
    expense.categoryId === null ? 'Sin categoría' : (labels.get(expense.categoryId) ?? '?');
  const amount = formatMoney(expense.amount, expense.currency);
  return `🗑️ ${formatShortDate(expense.spentAt)} ${amount} ${truncate(name, 14)}`;
}

/** Quita los botones del mensaje original (si ya no estan, no pasa nada). */
async function clearButtons(ctx: Context): Promise<void> {
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
}

/**
 * Muestra el menu de borrado con los ultimos gastos, uno por boton.
 *
 * @param header Texto opcional arriba del listado (ej. el resultado de borrar).
 */
async function showDeleteMenu(ctx: Context, user: User, header?: string): Promise<void> {
  const [expenses, labels, summary] = await Promise.all([
    listRecentExpenses(user.id, DELETE_MENU_SIZE),
    categoryLabelMap(user.id),
    getExpenseSummary(user.id),
  ]);

  if (expenses.length === 0) {
    await ctx.reply(
      header === undefined
        ? 'No tenés ningún gasto para borrar 🤷'
        : `${header}\n\nNo te queda ningún gasto 🤷`,
    );
    return;
  }

  const rows = expenses.map((expense) => [
    Markup.button.callback(deleteButtonLabel(expense, labels), `del:${expense.id}`),
  ]);
  rows.push([Markup.button.callback(`🗑️ Borrar TODO (${summary.count})`, 'reset:ask')]);
  rows.push([Markup.button.callback('❌ Cerrar', 'mng:close')]);

  const lines: string[] = [];
  if (header !== undefined) {
    lines.push(header, '');
  }
  lines.push(
    '🧾 ¿Cuál borro? Tocá el que quieras sacar.',
    '',
    `Tenés ${plural(summary.count, 'movimiento', 'movimientos')} por ${formatMoney(summary.total, user.currency)}.`,
  );

  await ctx.reply(lines.join('\n'), Markup.inlineKeyboard(rows));
}

/** Pide confirmacion antes de borrar todo. */
async function askReset(ctx: Context, user: User): Promise<void> {
  const summary = await getExpenseSummary(user.id);

  if (summary.count === 0) {
    await ctx.reply('No tenés gastos para borrar 🤷');
    return;
  }

  await ctx.reply(
    [
      '⚠️ ¿Seguro que querés borrar todo?',
      '',
      `Se van a borrar ${plural(summary.count, 'movimiento', 'movimientos')} por ${formatMoney(summary.total, user.currency)}.`,
      'Tus categorías propias no se tocan.',
      '',
      'No se puede deshacer desde el chat.',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('🗑️ Borrar solo los gastos', 'reset:exp')],
      [Markup.button.callback('🗑️ Gastos y topes', 'reset:all')],
      [Markup.button.callback('❌ Cancelar', 'reset:no')],
    ]),
  );
}

/** Borra todos los gastos (y opcionalmente los topes) y reporta el resultado. */
async function performReset(ctx: Context, user: User, withBudgets: boolean): Promise<void> {
  const deleted = await clearAllExpenses(user.id);
  const budgets = withBudgets ? await clearAllBudgets(user.id) : 0;

  const lines = [
    deleted === 0
      ? 'No había gastos para borrar 🤷'
      : `✅ Borré ${plural(deleted, 'movimiento', 'movimientos')}.`,
  ];

  if (withBudgets) {
    lines.push(
      budgets === 0
        ? 'No había topes para borrar.'
        : `🧹 También borré ${plural(budgets, 'tope', 'topes')}.`,
    );
  }

  lines.push('', 'Quedás con la cuenta limpia 😉');
  await ctx.reply(lines.join('\n'));
}

/** Resuelve el usuario del mensaje; si no se puede, ya responde y devuelve null. */
async function requireUser(ctx: Context): Promise<User | null> {
  const user = await resolveUser(ctx);
  if (user === null) {
    await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
    return null;
  }
  return user;
}

/** Mensaje de error para los logs. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Registra los comandos /borrar y /reset, y sus botones de confirmacion. */
export function registerManageHandler(bot: Telegraf): void {
  bot.command('borrar', async (ctx) => {
    try {
      const user = await requireUser(ctx);
      if (user !== null) {
        await showDeleteMenu(ctx, user);
      }
    } catch (error) {
      log.error('Fallo el menu de borrado', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió al borrar 🙈 Probá de nuevo.');
    }
  });

  bot.command('reset', async (ctx) => {
    try {
      const user = await requireUser(ctx);
      if (user !== null) {
        await askReset(ctx, user);
      }
    } catch (error) {
      log.error('Fallo el reset', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió al resetear 🙈 Probá de nuevo.');
    }
  });

  bot.action(/^(del|reset|mng):/, async (ctx) => {
    // Detiene el "relojito" del boton en el cliente.
    await ctx.answerCbQuery().catch(() => undefined);

    try {
      // `callbackQuery` es una union (puede venir de un juego): se comprueba la
      // propiedad en lugar de castear.
      const data = 'data' in ctx.callbackQuery ? (ctx.callbackQuery.data ?? '') : '';
      const user = await requireUser(ctx);
      if (user === null) {
        return;
      }

      // Cualquier accion invalida los botones del mensaje anterior.
      await clearButtons(ctx);

      if (data.startsWith('del:')) {
        const result = await deleteExpense(user.id, data.slice(4));
        const header =
          result.deleted && result.expense !== null
            ? `🗑️ Borrado: ${formatMoney(result.expense.amount, result.expense.currency)} del ${formatShortDate(result.expense.spentAt)}.`
            : (result.reason ?? 'No pude borrar ese gasto.');
        await showDeleteMenu(ctx, user, header);
        return;
      }

      if (data === 'reset:ask') {
        await askReset(ctx, user);
        return;
      }

      if (data === 'reset:no') {
        await ctx.reply('Listo, no borro nada 👍');
        return;
      }

      if (data === 'mng:close') {
        await ctx.reply('Listo 👍');
        return;
      }

      if (data === 'reset:exp' || data === 'reset:all') {
        await performReset(ctx, user, data === 'reset:all');
      }
    } catch (error) {
      log.error('Fallo la gestion de gastos', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió 🙈 Probá de nuevo.');
    }
  });
}