/**
 * Handler del comando /presupuesto.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/budget.handler.ts
 *
 * Uso:
 *   /presupuesto                  -> lista los presupuestos del mes
 *   /presupuesto super 50000      -> fija el presupuesto del mes actual
 *   /presupuesto nafta 50 lucas   -> acepta alias y montos coloquiales
 *
 * Tambien se puede pedir en lenguaje natural ("presupuesto de 50 lucas en super"):
 * de eso se encarga queries.service.
 */

import type { Telegraf } from 'telegraf';
import { listActiveForPeriod, upsertBudget } from '../../db/repositories/budgets.repo.js';
import { findSystemBySlug, listSystem } from '../../db/repositories/categories.repo.js';
import { STANDARD_CATEGORY_SLUGS } from '../../domain/types/expense.js';
import { formatAmount } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { parseMoneyPhrase, resolveCategorySlug } from '../../utils/nlp.js';
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

      const now = new Date();
      const periodYear = now.getUTCFullYear();
      const periodMonth = now.getUTCMonth() + 1;
      const args = ctx.message.text.trim().split(/\s+/).slice(1);

      // Sin argumentos: listado.
      if (args.length === 0) {
        const budgets = await listActiveForPeriod(user.id, periodYear, periodMonth);
        if (budgets.length === 0) {
          await ctx.reply(
            [
              'No tenes presupuestos para este mes.',
              'Para crear uno: /presupuesto supermercado 50000',
              '',
              `Categorias: ${STANDARD_CATEGORY_SLUGS.join(', ')}`,
            ].join('\n'),
          );
          return;
        }

        const categories = await listSystem();
        const names = new Map(categories.map((category) => [category.id, category.name]));
        const lines = budgets.map(
          (budget) =>
            `• ${names.get(budget.categoryId) ?? '?'}: ${formatAmount(budget.limitAmount, budget.currency)} (aviso al ${budget.alertThreshold}%)`,
        );

        await ctx.reply(['Presupuestos de este mes:', ...lines].join('\n'));
        return;
      }

      // Con argumentos: alta/actualizacion.
      const [rawSlug, rawAmount] = args;
      const slug = resolveCategorySlug(rawSlug ?? '');

      if (slug === null) {
        await ctx.reply(
          `No reconocí esa categoría. Probá con: ${STANDARD_CATEGORY_SLUGS.join(', ')} (o alias como "super", "nafta", "luz").`,
        );
        return;
      }

      const amount = parseMoneyPhrase(rawAmount ?? '');
      if (amount === null || amount <= 0) {
        await ctx.reply(
          'No entendí el monto. Ejemplos: /presupuesto super 50000 · /presupuesto nafta 50 lucas',
        );
        return;
      }

      const category = await findSystemBySlug(slug);
      if (category === null) {
        await ctx.reply('No encontre esa categoria.');
        return;
      }

      const budget = await upsertBudget({
        userId: user.id,
        categoryId: category.id,
        periodYear,
        periodMonth,
        limitAmount: amount,
        currency: user.currency,
      });

      await ctx.reply(
        [
          `Listo: presupuesto de ${formatAmount(budget.limitAmount, budget.currency)} para ${category.name}.`,
          `Te aviso al ${budget.alertThreshold}% y si lo superas.`,
        ].join('\n'),
      );
    } catch (error) {
      log.error('Fallo el handler de presupuesto', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Hubo un problema al procesar el presupuesto. Intenta de nuevo.');
    }
  });
}
