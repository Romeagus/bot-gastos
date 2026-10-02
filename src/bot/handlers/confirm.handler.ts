/**
 * Handler de los botones de confirmacion de gastos.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/confirm.handler.ts
 *
 * Los usa el flujo de foto de ticket: el gasto se guarda como `pending` y estos
 * botones lo pasan a `confirmed` o `rejected`.
 *
 * El `callback_data` es `exp:<uuid>:<y|n>`. El uuid alcanza para identificar el
 * gasto sin guardar estado en memoria, y el chequeo de dueno se hace en el
 * servicio: del cliente no se confia nada.
 */

import type { Telegraf } from 'telegraf';
import { evaluateBudgetAlert } from '../../services/budgets.service.js';
import { confirmExpense, rejectExpense } from '../../services/expenses.service.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:confirm');

/** `exp:<uuid>:<y|n>` */
const CALLBACK_PATTERN = /^exp:([0-9a-f-]{36}):([yn])$/;

/** Registra los botones de confirmar / descartar gasto. */
export function registerConfirmHandler(bot: Telegraf): void {
  bot.action(/^exp:/, async (ctx) => {
    // Detiene el "relojito" del boton en el cliente.
    await ctx.answerCbQuery().catch(() => undefined);

    try {
      // `callbackQuery` es una union (puede venir de un juego), por eso se
      // comprueba la propiedad en lugar de castear.
      const callbackData = 'data' in ctx.callbackQuery ? (ctx.callbackQuery.data ?? '') : '';
      const match = CALLBACK_PATTERN.exec(callbackData);
      if (match === null) {
        return;
      }

      const expenseId = match[1] ?? '';
      const action = match[2] ?? 'n';

      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      // Se sacan los botones para que no se pueda volver a tocar.
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);

      const result =
        action === 'y'
          ? await confirmExpense(user.id, expenseId)
          : await rejectExpense(user.id, expenseId);

      if (!result.changed) {
        await ctx.reply(result.reason ?? 'No pude procesar eso.');
        return;
      }

      if (action === 'n') {
        await ctx.reply('Listo, lo descarto 👍 No lo voy a contar.');
        return;
      }

      await ctx.reply('✅ Anotado.');

      // La alerta de presupuesto se dispara AL CONFIRMAR y no al leer la foto:
      // recien ahora el gasto cuenta de verdad.
      const expense = result.expense;
      if (expense !== null) {
        const alert = await evaluateBudgetAlert(expense);
        if (alert !== null) {
          await ctx.reply(alert);
        }
      }
    } catch (error) {
      log.error('Fallo el handler de confirmación', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió al confirmar 😅 Probá de nuevo.');
    }
  });
}