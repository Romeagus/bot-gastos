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
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { replyWithError } from '../reply-error.js';
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

    // Se declaran FUERA del try porque el catch los necesita para registrar el
    // error. Si fallara el `resolveUser` (y no pudiéramos identificar a quien
    // escribe), el id queda en null y el reporte se guarda igual, sin usuario.
    let userId: string | null = null;
    let bytes = 0;

    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }
      userId = user.id;

      // Telegram envia varias resoluciones: la ultima es la mas grande.
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      if (largest === undefined) {
        await ctx.reply('No pude leer la imagen 😕 Probá de nuevo.');
        return;
      }

      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const download = await fetch(fileLink);
      const imageBytes = new Uint8Array(await download.arrayBuffer());
      bytes = imageBytes.length;

      const parsed = await extractExpenseFromImage({
        image: imageBytes,
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
      // `AppError` = vision no configurada: no es un fallo, es una advertencia,
      // asi que se responde con su mensaje y sin registrar nada.
      if (error instanceof AppError) {
        log.warn('Vision no disponible', { error: error.message });
        await ctx.reply(error.message);
        return;
      }

      await replyWithError(ctx, userId, 'photo', error, {
        context: `vision (${bytes} bytes)`,
        extra: 'Fijate que se vea el TOTAL del ticket, o escribímelo a mano.',
      });
    }
  });
}
