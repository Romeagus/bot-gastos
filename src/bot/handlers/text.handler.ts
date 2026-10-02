/**
 * Handler de mensajes de texto.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/text.handler.ts
 */

import type { Telegraf } from 'telegraf';
import { handleRequest } from '../../services/queries.service.js';
import { createLogger } from '../../utils/logger.js';
import { isBudgetRequest } from '../../utils/nlp.js';
import { logExpenseFromText, resolveUser } from './shared.js';

const log = createLogger('bot:text');

/** Registra el handler de mensajes de texto (registro por lenguaje natural). */
export function registerTextHandler(bot: Telegraf): void {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();

    // Los comandos (/start, /help, ...) los maneja su propio handler.
    if (text.startsWith('/') || text === '') {
      return;
    }

    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificar tu usuario de Telegram. Proba de nuevo.');
        return;
      }

      // Un pedido de presupuesto NO es un gasto (aunque mencione monto y
      // categoria): lo resolvemos por el camino conversacional.
      const registered = isBudgetRequest(text)
        ? false
        : await logExpenseFromText(ctx, user, text, 'text', ctx.message.message_id);

      if (registered) {
        return;
      }

      // No era un gasto: lo interpretamos como consulta o pedido de presupuesto.
      const answer = await handleRequest(user, text);
      if (answer !== null) {
        await ctx.reply(answer);
        return;
      }

      await ctx.reply(
        [
          'No te entendí 🤔 Probá con alguna de estas:',
          '• "gasté 3500 en el super"',
          '• "cuánto gasté este mes"',
          '• "presupuesto de 50 lucas en super"',
        ].join('\n'),
      );
    } catch (error) {
      log.error('Fallo el handler de texto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Hubo un problema al registrar el gasto. Intenta de nuevo en un momento.');
    }
  });
}
