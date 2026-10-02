/**
 * Registro central de handlers del bot.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/index.ts
 *
 * Punto unico donde se dan de alta los comandos y listeners. Agregar cada nuevo
 * handler aca mantiene `src/index.ts` libre de detalles.
 */

import type { Telegraf } from 'telegraf';
import { registerAudioHandler } from './audio.handler.js';
import { registerBudgetHandler } from './budget.handler.js';
import { registerCategoryHandler } from './category.handler.js';
import { registerHelpHandler } from './help.handler.js';
import { registerPhotoHandler } from './photo.handler.js';
import { registerStartHandler } from './start.handler.js';
import { registerTextHandler } from './text.handler.js';

/** Registra todos los handlers del bot. */
export function registerHandlers(bot: Telegraf): void {
  registerStartHandler(bot);
  registerHelpHandler(bot);
  registerBudgetHandler(bot);
  registerCategoryHandler(bot);
  registerTextHandler(bot);
  registerAudioHandler(bot);
  registerPhotoHandler(bot);
}
