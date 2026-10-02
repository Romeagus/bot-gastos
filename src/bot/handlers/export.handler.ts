/**
 * Handler del comando /exportar.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/export.handler.ts
 *
 * Envia un CSV con TODOS los gastos del usuario. Es la puerta de salida del dato:
 * sin esto, el historico queda atrapado en la base y el usuario no puede llevarlo
 * a una planilla para analizarlo.
 *
 * Este handler es solo el atajo del comando: el archivo se arma en
 * `buildExportAnswer` y lo envia `replyAnswer`, los MISMOS que usan el pedido en
 * lenguaje natural y por audio. Asi no hay dos implementaciones que puedan
 * divergir (y no volver a pasar lo que paso: un camino con el CSV bien y otro roto).
 */

import type { Telegraf } from 'telegraf';
import { buildExportAnswer } from '../../services/export.service.js';
import { createLogger } from '../../utils/logger.js';
import { replyWithError } from '../reply-error.js';
import { replyAnswer, resolveUser } from './shared.js';

const log = createLogger('bot:export');

/** Registra el comando /exportar. */
export function registerExportHandler(bot: Telegraf): void {
  bot.command('exportar', async (ctx) => {
    // Se declara fuera del try porque el catch la necesita.
    let userId: string | null = null;

    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }
      userId = user.id;

      const answer = await buildExportAnswer(user);
      await replyAnswer(ctx, answer);

      if (answer.document !== undefined) {
        log.info('CSV exportado', { userId: user.id });
      }
    } catch (error) {
      await replyWithError(ctx, userId, 'command', error, {
        context: 'exportacion CSV',
        extra: 'Si tenés muchos gastos puede tardar un poco, probá de nuevo.',
      });
    }
  });
}
