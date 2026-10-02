/**
 * Handler del comando /resumen.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/summary.handler.ts
 *
 * Muestra el mismo reporte que el bot manda solo los lunes, pero a pedido. Sirve
 * para dos cosas:
 *   1. No tener que esperar al lunes para ver "cómo viene el mes".
 *   2. Poder probar el mensaje del job en cualquier momento.
 *
 * Reutiliza `buildWeeklyReport` (el mismo texto que arma el job semanal): si
 * divergieran, el usuario veria una cosa los lunes y otra al pedirlo.
 */

import type { Telegraf } from 'telegraf';
import { buildWeeklyReport } from '../../services/weekly-report.service.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:summary');

/** Registra el comando /resumen. */
export function registerSummaryHandler(bot: Telegraf): void {
  bot.command('resumen', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      const report = await buildWeeklyReport(user);
      await ctx.reply(report ?? 'Todavía no anotaste ningún gasto este mes 🤷');
    } catch (error) {
      log.error('Fallo el comando /resumen', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió armando el resumen 🙈 Probá de nuevo.');
    }
  });
}
