/**
 * Handler del comando /exportar.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/export.handler.ts
 *
 * Envia un CSV con TODOS los gastos del usuario. Es la puerta de salida del dato:
 * sin esto, el historico queda atrapado en la base y el usuario no puede llevarlo
 * a una planilla para analizarlo.
 *
 * Usa `Input.fromBuffer` (API oficial de Telegraf) porque el CSV se arma en
 * memoria: no hace falta escribir un archivo temporal en disco.
 */

import { Input, type Telegraf } from 'telegraf';
import { listAllByUser } from '../../db/repositories/expenses.repo.js';
import { categoryNameMap } from '../../services/categories.service.js';
import { buildCsv, csvFilename } from '../../services/export.service.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:export');

/** Registra el comando /exportar. */
export function registerExportHandler(bot: Telegraf): void {
  bot.command('exportar', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      const expenses = await listAllByUser(user.id);

      if (expenses.length === 0) {
        await ctx.reply('Todavía no tenés gastos para exportar 🤷');
        return;
      }

      // Sin emoji en la categoria: en una planilla el emoji rompe el agrupado.
      const names = await categoryNameMap(user.id);
      const csv = buildCsv(expenses, names);

      await ctx.replyWithDocument(
        Input.fromBuffer(Buffer.from(csv, 'utf8'), csvFilename()),
        { caption: `📊 Acá tenés tus ${expenses.length} gastos, listos para abrir en Excel.` },
      );

      log.info('CSV exportado', { userId: user.id, rows: expenses.length });
    } catch (error) {
      log.error('Fallo la exportacion a CSV', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('No pude armar el archivo 🙈 Probá de nuevo en un rato.');
    }
  });
}
