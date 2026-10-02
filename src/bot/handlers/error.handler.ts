/**
 * Handler del comando /error.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/error.handler.ts
 *
 * Muestra los ultimos errores que el usuario vio, con su codigo. Sirve para que
 * pueda decir "me paso esto" y seguir avanzando, y para encontrar el error exacto
 * en el log sin depender de que recuerde cuando le paso.
 */

import type { Telegraf } from 'telegraf';
import { recentErrors } from '../../services/diagnostics.service.js';
import { createLogger } from '../../utils/logger.js';
import { replyWithError } from '../reply-error.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:error');

/** Etiqueta legible del origen del error. */
const SOURCE_LABELS: Record<string, string> = {
  text: 'texto',
  audio: 'audio',
  photo: 'foto',
  command: 'comando',
  job: 'tarea programada',
  unknown: 'mensaje',
};

/** dd/mm a las hh:mm, en hora local del servidor (es un diagnostico, no contabilidad). */
function when(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** Registra el comando /error. */
export function registerErrorHandler(bot: Telegraf): void {
  bot.command('error', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      const errors = await recentErrors(user.id, 5);

      if (errors.length === 0) {
        await ctx.reply('No tengo ningún error registrado tuyo 🙌 Todo anduvo bien.');
        return;
      }

      const lines = ['🩺 Últimos errores tuyos:', ''];

      for (const item of errors) {
        const source = SOURCE_LABELS[item.source] ?? item.source;
        lines.push(`• ${item.code} · ${when(item.createdAt)} · ${source}`);
      }

      lines.push('', 'Si alguno se repite, pasame el código y lo reviso.');

      await ctx.reply(lines.join('\n'));
    } catch (error) {
      log.error('Fallo el comando /error', {
        error: error instanceof Error ? error.message : String(error),
      });
      await replyWithError(ctx, null, 'command', error);
    }
  });
}
