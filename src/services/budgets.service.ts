/**
 * Presupuestos: estado de avance y alertas preventivas.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/budgets.service.ts
 *
 * Este modulo responde dos preguntas:
 *   1. "¿Como vienen mis presupuestos?"          -> `getBudgetStatuses()`.
 *   2. "¿Me tengo que preocupar por este gasto?" -> `evaluateBudgetAlert()`.
 *
 * Todo el calculo lo hace el codigo con SQL: la IA no participa.
 *
 * Sobre las alertas: antes se avisaba solo en el instante exacto en que se
 * cruzaba el umbral, asi que si el usuario ya estaba pasado no volvia a ver
 * nada nunca mas. Ahora el aviso se repite en cada gasto mientras la categoria
 * siga en zona de alerta o pasada del tope: es un recordatorio de verdad.
 *
 * Limitacion conocida: el periodo se calcula en UTC (ignora `users.timezone`).
 */

import {
  deactivateAllForUser,
  deactivateForCategory,
  findActiveForCategory,
  listActiveForPeriod,
} from '../db/repositories/budgets.repo.js';
import { findById as findCategoryById, listForUser } from '../db/repositories/categories.repo.js';
import { sumByCategory } from '../db/repositories/expenses.repo.js';
import type { Budget } from '../domain/types/budget.js';
import type { Category } from '../domain/types/category.js';
import type { Expense } from '../domain/types/expense.js';
import { formatMoney } from '../utils/format.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('service:budgets');

/** Como viene una categoria respecto de su tope. */
export type BudgetState = 'ok' | 'near' | 'over';

export interface BudgetStatus {
  readonly budget: Budget;
  readonly category: Category | null;
  readonly spent: number;
  readonly remaining: number;
  /** Porcentaje consumido (puede pasar de 100 si se excedio). */
  readonly percent: number;
  readonly state: BudgetState;
}

/** Periodo (anio, mes) al que pertenece una fecha, en UTC. */
export function periodOf(date: Date): { year: number; month: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * Rango [inicio, fin) del mes de una fecha, en UTC.
 *
 * Se exporta porque el resumen semanal necesita exactamente el mismo corte que
 * las alertas de presupuesto: si cada uno calculara el mes por su cuenta, un
 * gasto del dia 31 podria contarse en un reporte y no en el otro.
 */
export function monthRange(date: Date): { from: Date; to: Date } {
  const { year, month } = periodOf(date);
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    to: new Date(Date.UTC(year, month, 1)),
  };
}

/** Etiqueta visible de la categoria ('🛒 Supermercado'). */
function labelOf(category: Category | null): string {
  return category === null ? 'Sin categoría' : `${category.emoji ?? ''} ${category.name}`.trim();
}

/** Barra de 10 bloques para ver el avance de un vistazo. */
function progressBar(percent: number): string {
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)));
  return `${'▓'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

/** Icono segun el estado del presupuesto. */
function iconOf(state: BudgetState): string {
  if (state === 'over') {
    return '🚨';
  }
  return state === 'near' ? '⚠️' : '✅';
}

function stateOf(spent: number, limit: number, threshold: number): BudgetState {
  if (spent >= limit) {
    return 'over';
  }
  return limit > 0 && (spent / limit) * 100 >= threshold ? 'near' : 'ok';
}

/**
 * Estado de todos los presupuestos activos de un periodo: limite, gastado,
 * restante, porcentaje y estado. Es la base del reporte y de las alertas.
 */
export async function getBudgetStatuses(
  userId: string,
  year: number,
  month: number,
): Promise<BudgetStatus[]> {
  const budgets = await listActiveForPeriod(userId, year, month);
  if (budgets.length === 0) {
    return [];
  }

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const [totals, categories] = await Promise.all([
    sumByCategory(userId, from, to),
    listForUser(userId),
  ]);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  return budgets.map((budget) => {
    // Se compara por categoria Y moneda: un tope no debe mezclar ARS con USD.
    const spent = totals
      .filter((row) => row.categoryId === budget.categoryId && row.currency === budget.currency)
      .reduce((acc, row) => acc + row.total, 0);

    const limit = budget.limitAmount;
    return {
      budget,
      category: categoriesById.get(budget.categoryId) ?? null,
      spent,
      remaining: Math.max(0, limit - spent),
      percent: limit <= 0 ? 0 : Math.round((spent / limit) * 100),
      state: stateOf(spent, limit, budget.alertThreshold),
    };
  });
}

/** Estado de una categoria puntual dentro de un periodo (o `null`). */
export async function getBudgetStatusForCategory(
  userId: string,
  categoryId: string,
  year: number,
  month: number,
): Promise<BudgetStatus | null> {
  const statuses = await getBudgetStatuses(userId, year, month);
  return statuses.find((status) => status.budget.categoryId === categoryId) ?? null;
}

/** Una linea resumen del avance, sin repetir el nombre de la categoria. */
export function describeProgress(status: BudgetStatus): string {
  const currency = status.budget.currency;
  const limit = formatMoney(status.budget.limitAmount, currency);

  if (status.state === 'over') {
    const excess = status.spent - status.budget.limitAmount;
    return `te pasaste por ${formatMoney(excess, currency)} (llevás ${formatMoney(status.spent, currency)} de ${limit})`;
  }

  return `llevás ${formatMoney(status.spent, currency)} de ${limit} (${status.percent}%) y te quedan ${formatMoney(status.remaining, currency)}`;
}

/** Reporte completo de presupuestos, listo para mandar al chat. */
export function formatBudgetReport(statuses: readonly BudgetStatus[], periodLabel: string): string {
  const lines = statuses.map((status) =>
    [
      `${iconOf(status.state)} ${labelOf(status.category)}`,
      `   ${progressBar(status.percent)} ${status.percent}%`,
      `   ${describeProgress(status)}`,
    ].join('\n'),
  );

  const totalLimit = statuses.reduce((acc, status) => acc + status.budget.limitAmount, 0);
  const totalSpent = statuses.reduce((acc, status) => acc + status.spent, 0);
  const currency = statuses[0]?.budget.currency ?? 'ARS';
  const totalPercent = totalLimit <= 0 ? 0 : Math.round((totalSpent / totalLimit) * 100);

  return [
    `🎯 Tus topes de ${periodLabel}:`,
    '',
    ...lines,
    '',
    `Total: ${formatMoney(totalSpent, currency)} de ${formatMoney(totalLimit, currency)} (${totalPercent}%) · te quedan ${formatMoney(Math.max(0, totalLimit - totalSpent), currency)}`,
  ].join('\n');
}

/**
 * Evalua si el gasto recien registrado amerita un aviso de presupuesto.
 *
 * @returns El texto del aviso, o `null` si no corresponde decir nada.
 */
export async function evaluateBudgetAlert(expense: Expense): Promise<string | null> {
  if (expense.categoryId === null) {
    return null;
  }

  const { year, month } = periodOf(expense.spentAt);
  const budget = await findActiveForCategory(expense.userId, expense.categoryId, year, month);

  if (budget === null || budget.limitAmount <= 0) {
    return null;
  }

  const { from, to } = monthRange(expense.spentAt);
  const totals = await sumByCategory(expense.userId, from, to);
  // Se filtra por categoria Y moneda: el tope es de una sola moneda.
  const after = totals
    .filter((row) => row.categoryId === expense.categoryId && row.currency === budget.currency)
    .reduce((acc, row) => acc + row.total, 0);
  const before = after - expense.amount;

  const currency = budget.currency;
  const limit = budget.limitAmount;
  const threshold = (limit * budget.alertThreshold) / 100;
  const percent = Math.round((after / limit) * 100);
  const remaining = Math.max(0, limit - after);

  const category = await findCategoryById(expense.categoryId);
  const label = labelOf(category);
  const money = (value: number): string => formatMoney(value, currency);

  // 1) Con este gasto se cruzo el tope: aviso fuerte.
  if (before < limit && after >= limit) {
    log.info('Alerta: tope superado', { categoryId: expense.categoryId, after, limit });
    return [
      `🚨 ¡Pum! Te pasaste del tope de ${label}.`,
      `Llevás ${money(after)} de ${money(limit)} (${percent}%).`,
    ].join('\n');
  }

  // 2) Ya venia pasado y sigue pasado: recordatorio corto en cada gasto.
  if (before >= limit) {
    return `🚨 Seguís pasado en ${label}: ${money(after)} de ${money(limit)}.`;
  }

  // 3) Con este gasto se cruzo el umbral de aviso.
  if (before < threshold && after >= threshold) {
    log.info('Alerta: umbral alcanzado', { categoryId: expense.categoryId, after, limit });
    return [
      `⚠️ Ojo que llegaste al ${percent}% del tope de ${label}.`,
      `Te quedan ${money(remaining)} de ${money(limit)}.`,
    ].join('\n');
  }

  // 4) Ya estaba en zona de alerta: recordatorio en cada gasto.
  if (after >= threshold) {
    return `⚠️ ${label}: vas ${percent}% del tope, te quedan ${money(remaining)}.`;
  }

  // Todavia va tranquilo: no se dice nada.
  return null;
}

/**
 * Borra el tope de una categoria en un periodo (borrado logico: se desactiva).
 *
 * @returns `true` si habia un tope activo y se borro.
 */
export async function deleteBudgetForCategory(
  userId: string,
  categoryId: string,
  year: number,
  month: number,
): Promise<boolean> {
  return deactivateForCategory(userId, categoryId, year, month);
}

/** Borra TODOS los topes del usuario. @returns cuantos se borraron. */
export async function clearAllBudgets(userId: string): Promise<number> {
  const count = await deactivateAllForUser(userId);
  log.info('Topes borrados en bloque', { userId, count });
  return count;
}
