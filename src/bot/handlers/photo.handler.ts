/**
 * Handler de fotos (tickets / comprobantes).
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/photo.handler.ts
 *
 * Flujo: descarga de la foto de Telegram -> extraccion con vision (Qwen2.5-VL)
 * -> registro (mismo camino que texto y audio).
 */

import type { Telegraf } from 'telegraf';
import { env } from '../../config/env.js';
import { extractExpenseFromImage } from '../../services/ai/vision.service.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { replyExpense, resolveUser } from './shared.js';

const log = createLogger('bot:photo');

const NOT_CONFIGURED = [
  'La lectura de tickets todavia no esta configurada.',
  'Mientras tanto, podes escribirmelo ("gaste 3500 en el super") o mandarme un audio.',
].join('\n');

/** Registra el handler de fotos. */
export function registerPhotoHandler(bot: Telegraf): void {
  bot.on('photo', async (ctx) => {
    if (env.OPENROUTER_API_KEY === undefined) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificar tu usuario de Telegram. Proba de nuevo.');
        return;
      }

      // Telegram envia varias resoluciones: la ultima es la mas grande.
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      if (largest === undefined) {
        await ctx.reply('No pude leer la imagen. Proba de nuevo.');
        return;
      }

      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const download = await fetch(fileLink);
      const bytes = new Uint8Array(await download.arrayBuffer());

      const parsed = await extractExpenseFromImage({
        image: bytes,
        mimeType: 'image/jpeg',
        today: new Date().toISOString().slice(0, 10),
        defaultCurrency: user.currency,
      });

      if (parsed === null) {
        await ctx.reply(
          'No pude encontrar un gasto en esa imagen. Asegurate de que se vea el total del ticket.',
        );
        return;
      }

      await replyExpense(
        ctx,
        user,
        parsed,
        'photo',
        ctx.message.caption ?? 'foto de ticket',
        env.VISION_MODEL,
        ctx.message.message_id,
      );
    } catch (error) {
      if (error instanceof AppError) {
        log.warn('Vision no disponible', { error: error.message });
        await ctx.reply(error.message);
        return;
      }
      log.error('Fallo el handler de foto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Hubo un problema al procesar la imagen. Intenta de nuevo en un momento.');
    }
  });
}
