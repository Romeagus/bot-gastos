/**
 * Handler de mensajes de texto.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/text.handler.ts
 *
 * El ruteo (gasto / consulta / presupuesto / categoria) NO vive aca: esta en
 * `handleFreeText`, porque el audio usa exactamente el mismo camino.
 */

import type { Telegraf } from 'telegraf';
import { createLogger } from '../../utils/logger.js';
import { handleFreeText, resolveUser } from './shared.js';

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
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      await handleFreeText(ctx, user, text, 'text', ctx.message.message_id);
    } catch (error) {
      log.error('Fallo el handler de texto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió de mi lado 🙈 Probá de nuevo en un momento.');
    }
  });
}
