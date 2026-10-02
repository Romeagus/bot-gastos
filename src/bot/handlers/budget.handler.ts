/**
 * Handler del comando /presupuesto.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/budget.handler.ts
 *
 * Uso:
 *   /presupuesto                          -> lista los presupuestos del mes
 *   /presupuesto supermercado 50000       -> fija el presupuesto del mes actual
 */

import type { Telegraf } from 'telegraf';
import { listActiveForPeriod, upsertBudget } from '../../db/repositories/budgets.repo.js';
import { findSystemBySlug, listSystem } from '../../db/repositories/categories.repo.js';
import { STANDARD_CATEGORY_SLUGS, type StandardCategorySlug } from '../../domain/types/expense.js';
import { formatAmount, parseAmount } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:budget');

function isStandardSlug(value: string): value is StandardCategorySlug {
  return (STANDARD_CATEGORY_SLUGS as readonly string[]).includes(value);
}

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
      const slug = (rawSlug ?? '').toLowerCase();

      if (!isStandardSlug(slug)) {
        await ctx.reply(`Categoria invalida. Usa una de: ${STANDARD_CATEGORY_SLUGS.join(', ')}`);
        return;
      }

      const amount = parseAmount(rawAmount ?? '');
      if (amount === null || amount <= 0) {
        await ctx.reply('Monto invalido. Ejemplo: /presupuesto supermercado 50000');
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
