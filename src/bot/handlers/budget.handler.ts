/**
 * Handler del comando /presupuesto.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/budget.handler.ts
 *
 * Uso:
 *   /presupuesto                  -> topes del mes con gastado y restante
 *   /presupuesto super 50000      -> fija el tope del mes actual
 *   /presupuesto nafta 50 lucas   -> acepta alias y montos coloquiales
 *
 * Tambien se puede pedir en lenguaje natural ("presupuesto de 50 lucas en super")
 * o por audio: de eso se encarga `queries.service`.
 */

import type { Telegraf } from 'telegraf';
import { upsertBudget } from '../../db/repositories/budgets.repo.js';
import { findForUserBySlug } from '../../db/repositories/categories.repo.js';
import {
  describeProgress,
  formatBudgetReport,
  getBudgetStatuses,
  getBudgetStatusForCategory,
  periodOf,
} from '../../services/budgets.service.js';
import { listAvailableCategories } from '../../services/categories.service.js';
import { formatMoney } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { parseMoneyPhrase, resolveCategorySlug, slugifyCategory } from '../../utils/nlp.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:budget');

/** Registra el comando /presupuesto. */
export function registerBudgetHandler(bot: Telegraf): void {
  bot.command('presupuesto', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificar tu usuario de Telegram. Proba de nuevo.');
        return;
      }

      const { year, month } = periodOf(new Date());
      const args = ctx.message.text.trim().split(/\s+/).slice(1);

      // Sin argumentos: reporte con gastado, restante y porcentaje.
      if (args.length === 0) {
        const statuses = await getBudgetStatuses(user.id, year, month);
        if (statuses.length === 0) {
          await ctx.reply(
            [
              'Todavía no tenés topes para este mes 🤷',
              '',
              'Creá uno así: /presupuesto supermercado 50000',
              'O por chat: "presupuesto de 50 lucas en super"',
            ].join('\n'),
          );
          return;
        }

        await ctx.reply(formatBudgetReport(statuses, 'este mes'));
        return;
      }

      // Con argumentos: alta/actualizacion. El primer termino es la categoria
      // (acepta alias y categorias propias) y el resto, el monto.
      const rawCategory = args[0] ?? '';
      const slug = resolveCategorySlug(rawCategory) ?? slugifyCategory(rawCategory);
      const category = slug === null ? null : await findForUserBySlug(user.id, slug);

      if (category === null) {
        const categories = await listAvailableCategories(user.id);
        await ctx.reply(
          [
            `No tengo ninguna categoría "${rawCategory}" 🤔`,
            `Tengo: ${categories.map((item) => item.slug).join(', ')}.`,
            `Si querés la creo: "creá la categoría ${rawCategory}"`,
          ].join('\n'),
        );
        return;
      }

      const amount = parseMoneyPhrase(args.slice(1).join(' '));
      if (amount === null || amount <= 0) {
        await ctx.reply(
          'No te entendí el monto 😅 Ejemplos: /presupuesto super 50000 · /presupuesto nafta 50 lucas',
        );
        return;
      }

      const budget = await upsertBudget({
        userId: user.id,
        categoryId: category.id,
        periodYear: year,
        periodMonth: month,
        limitAmount: amount,
        currency: user.currency,
      });

      const label = `${category.emoji ?? ''} ${category.name}`.trim();
      const lines = [
        `🎯 Listo, tope de ${formatMoney(budget.limitAmount, budget.currency)} en ${label}.`,
      ];

      // Si ya habia gastos este mes en esa categoria, se muestran al toque.
      const status = await getBudgetStatusForCategory(user.id, category.id, year, month);
      if (status !== null && status.spent > 0) {
        lines.push(`Ojo que ya ${describeProgress(status)}.`);
      }
      lines.push(`Te aviso cuando llegues al ${budget.alertThreshold}% y si lo pasás.`);

      await ctx.reply(lines.join('\n'));
    } catch (error) {
      log.error('Fallo el handler de presupuesto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió con el presupuesto 🙈 Probá de nuevo.');
    }
  });
}
