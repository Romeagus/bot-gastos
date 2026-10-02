/**
 * Instancia de Telegraf y manejo global de errores.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/bot.ts
 *
 * Responsabilidad unica: construir el objeto `Telegraf` y configurar lo comun a
 * todos los handlers (manejo de errores). El registro de handlers vive en
 * `src/bot/handlers`.
 */

import { Telegraf } from 'telegraf';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('bot');

/** Crea la instancia de Telegraf lista para registrar handlers. */
export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  // Sin este catch, una excepcion dentro de un handler se propaga sin control
  // y el usuario no recibe respuesta.
  bot.catch((error: unknown, ctx) => {
    log.error('Error no controlado en un handler', {
      updateType: ctx.updateType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });

  return bot;
}
