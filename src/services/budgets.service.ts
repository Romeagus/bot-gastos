/**
 * Alertas preventivas de presupuesto.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/budgets.service.ts
 *
 * Estrategia SIN estado: en lugar de recordar "ya avise", se comparan los
 * acumulados antes y despues del gasto recien registrado. Si el umbral o el
 * limite se cruzaron justo con este gasto, se emite la alerta. Asi no hace
 * falta ninguna columna extra en `budgets`.
 *
 * Limitacion conocida: el periodo se calcula en UTC (ignora `users.timezone`).
 */

import { findActiveForCategory } from '../db/repositories/budgets.repo.js';
import { sumByCategory } from '../db/repositories/expenses.repo.js';
import type { Expense } from '../domain/types/expense.js';
import { createLogger } from '../utils/logger.js';
import { formatAmount } from '../utils/format.js';

const log = createLogger('service:budgets');

/** Rango [inicio, fin) del mes de una fecha, en UTC. */
function monthRange(date: Date): { from: Date; to: Date; year: number; month: number } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
    year,
    month,
  };
}

/**
 * Evalua si el gasto recien registrado disparo una alerta de presupuesto.
 *
 * @returns El texto de la alerta, o `null` si no corresponde avisar.
 */
export async function evaluateBudgetAlert(expense: Expense): Promise<string | null> {
  if (expense.categoryId === null) {
    return null;
  }

  const { year, month, from, to } = monthRange(expense.spentAt);
  const budget = await findActiveForCategory(expense.userId, expense.categoryId, year, month);

  if (budget === null || budget.limitAmount <= 0) {
    return null;
  }

  const totals = await sumByCategory(expense.userId, from, to);
  const after =
    totals.find((row) => row.categoryId === expense.categoryId)?.total ?? expense.amount;
  const before = after - expense.amount;

  const limit = budget.limitAmount;
  const threshold = (limit * budget.alertThreshold) / 100;

  if (before < limit && after >= limit) {
    log.info('Alerta: limite superado', { categoryId: expense.categoryId, after, limit });
    return [
      `⚠️ Superaste el presupuesto de ${formatAmount(limit, budget.currency)}.`,
      `Llevas ${formatAmount(after, budget.currency)} este mes.`,
    ].join('\n');
  }

  if (before < threshold && after >= threshold) {
    const percent = Math.round((after / limit) * 100);
    log.info('Alerta: umbral alcanzado', { categoryId: expense.categoryId, after, limit });
    return [
      `🔔 Vas ${percent}% del presupuesto (${formatAmount(after, budget.currency)} de ${formatAmount(limit, budget.currency)}).`,
      `Te quedan ${formatAmount(limit - after, budget.currency)}.`,
    ].join('\n');
  }

  return null;
}
