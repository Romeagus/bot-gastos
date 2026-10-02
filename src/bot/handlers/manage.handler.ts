/**
 * Handler de gestion de gastos: /borrar, /editar y /reset.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/manage.handler.ts
 *
 * Los menus viven en `expenses-menu.service`: los comparten estos comandos y el
 * lenguaje natural ("borrá el último"). Eso es justamente lo que permite que el
 * camino conversacional pida confirmacion en vez de actuar solo.
 *
 * El borrado es LOGICO (`status = 'rejected'`): el gasto desaparece de totales,
 * topes y listados, y la fila queda en la base por si hay que recuperarla.
 *
 * callback_data:
 *   del:<uuid>           -> borra ese gasto
 *   edt:<uuid>           -> menu de "que quiero cambiar"
 *   edtf:<uuid>:<campo>  -> pide el valor nuevo (monto o categoria)
 *   reset:ask|exp|all|no -> borrar todo, con confirmacion
 *   mng:close            -> cierra el menu
 */

import { type Context, type Telegraf } from 'telegraf';
import type { User } from '../../domain/types/user.js';
import { plural } from '../../services/answer.js';
import { clearAllBudgets } from '../../services/budgets.service.js';
import {
  buildDeleteMenu,
  buildEditFieldMenu,
  buildEditMenu,
  buildResetConfirmation,
} from '../../services/expenses-menu.service.js';
import { clearAllExpenses, deleteExpense } from '../../services/expenses.service.js';
import { formatMoney, formatShortDate } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { setPendingEdit } from '../pending-edit.js';
import { replyAnswer, resolveUser } from './shared.js';

const log = createLogger('bot:manage');

/** Quita los botones del mensaje original (si ya no estan, no pasa nada). */
async function clearButtons(ctx: Context): Promise<void> {
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
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

/** Registra los comandos /borrar, /editar y /reset, y sus botones. */
export function registerManageHandler(bot: Telegraf): void {
  bot.command('borrar', async (ctx) => {
    try {
      const user = await requireUser(ctx);
      if (user !== null) {
        await replyAnswer(ctx, await buildDeleteMenu(user));
      }
    } catch (error) {
      log.error('Fallo el menu de borrado', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió al borrar 🙈 Probá de nuevo.');
    }
  });

  bot.command('editar', async (ctx) => {
    try {
      const user = await requireUser(ctx);
      if (user !== null) {
        await replyAnswer(ctx, await buildEditMenu(user));
      }
    } catch (error) {
      log.error('Fallo el menu de edicion', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió al editar 🙈 Probá de nuevo.');
    }
  });

  bot.command('reset', async (ctx) => {
    try {
      const user = await requireUser(ctx);
      if (user !== null) {
        await replyAnswer(ctx, await buildResetConfirmation(user));
      }
    } catch (error) {
      log.error('Fallo el reset', { error: describe(error) });
      await ctx.reply('Uhh, algo se me rompió al resetear 🙈 Probá de nuevo.');
    }
  });

  bot.action(/^(del|edt|edtf|reset|mng):/, async (ctx) => {
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
        await replyAnswer(ctx, await buildDeleteMenu(user, header));
        return;
      }

      if (data.startsWith('edt:')) {
        await replyAnswer(ctx, await buildEditFieldMenu(user, data.slice(4)));
        return;
      }

      // Se guarda que se esta editando y se pide el valor nuevo: el proximo
      // mensaje del usuario (texto o audio) se interpreta como ese valor.
      if (data.startsWith('edtf:')) {
        const parts = data.split(':');
        const expenseId = parts[1];
        const field = parts[2];

        if (expenseId === undefined || (field !== 'amount' && field !== 'category')) {
          return;
        }

        setPendingEdit(user.id, expenseId, field);
        await ctx.reply(
          field === 'amount'
            ? '💸 ¿Cuál es el monto correcto? Pasámelo con un número (ej. "4500").'
            : '🏷️ ¿A qué categoría lo paso? Mandame el nombre (ej. "comida").',
        );
        return;
      }

      if (data === 'reset:ask') {
        await replyAnswer(ctx, await buildResetConfirmation(user));
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