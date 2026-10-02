/**
 * Handler de fotos (tickets / comprobantes).
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/photo.handler.ts
 *
 * Flujo: descarga de la foto de Telegram -> extraccion con vision -> CONFIRMACION
 * del usuario con botones -> registro (mismo camino que texto y audio).
 *
 * Por que la confirmacion no es opcional: un texto lo escribe el usuario, pero un
 * ticket lo interpreta la IA. Leer mal el monto (19.000 -> 19) es un error de
 * plata y solo la persona puede verificarlo mirando la foto.
 */

import type { Telegraf } from 'telegraf';
import { env } from '../../config/env.js';
import { availableCategorySlugs } from '../../services/categories.service.js';
import {
  extractExpenseFromImage,
  isVisionConfigured,
} from '../../services/ai/vision.service.js';
import { AiProviderError, AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { replyExpensePending, resolveUser } from './shared.js';

const log = createLogger('bot:photo');

const NOT_CONFIGURED = [
  'La lectura de tickets no está configurada 🙈',
  'Mientras tanto, escribímelo ("gasté 3500 en el super") o mandame un audio.',
].join('\n');

/** Registra el handler de fotos. */
export function registerPhotoHandler(bot: Telegraf): void {
  bot.on('photo', async (ctx) => {
    if (!isVisionConfigured()) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      // Telegram envia varias resoluciones: la ultima es la mas grande.
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      if (largest === undefined) {
        await ctx.reply('No pude leer la imagen 😕 Probá de nuevo.');
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
        // Se le ofrecen al modelo las categorias reales del usuario, igual que
        // en el camino de texto: un ticket del gimnasio cae en su categoria.
        categorySlugs: await availableCategorySlugs(user.id),
      });

      if (parsed === null) {
        await ctx.reply(
          [
            'No pude encontrar un gasto en esa imagen 🤔',
            'Fijate que se vea el TOTAL del ticket, o escribímelo a mano.',
          ].join('\n'),
        );
        return;
      }

      // Queda PENDIENTE hasta que el usuario toque el boton de confirmar.
      await replyExpensePending(
        ctx,
        user,
        parsed,
        'photo',
        ctx.message.caption ?? 'foto de ticket',
        env.VISION_MODEL,
        ctx.message.message_id,
      );
    } catch (error) {
      if (error instanceof AiProviderError) {
        log.error('Fallo la extraccion del ticket', {
          status: error.status,
          detail: error.detail,
          error: error.message,
        });
        await ctx.reply('No pude leer el ticket 😔 Probá de nuevo en un momento.');
        return;
      }

      if (error instanceof AppError) {
        log.warn('Vision no disponible', { error: error.message });
        await ctx.reply(error.message);
        return;
      }

      log.error('Fallo el handler de foto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió con la imagen 🙈 Probá de nuevo en un momento.');
    }
  });
}
