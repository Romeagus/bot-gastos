/**
 * Repositorio de presupuestos (tabla `budgets`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/budgets.repo.ts
 */

import type { QueryResultRow } from 'pg';
import { query } from '../client.js';
import type { Budget } from '../../domain/types/budget.js';

interface BudgetRow extends QueryResultRow {
  id: string;
  user_id: string;
  category_id: string;
  period_year: number;
  period_month: number;
  limit_amount: string; // NUMERIC -> string
  currency: string;
  alert_threshold: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const BUDGET_COLUMNS = `
  id, user_id, category_id, period_year, period_month, limit_amount,
  currency, alert_threshold, is_active, created_at, updated_at
`;

function toBudget(row: BudgetRow): Budget {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    periodYear: row.period_year,
    periodMonth: row.period_month,
    limitAmount: Number(row.limit_amount),
    currency: row.currency,
    alertThreshold: row.alert_threshold,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertBudgetInput {
  readonly userId: string;
  readonly categoryId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly limitAmount: number;
  readonly currency: string;
  readonly alertThreshold?: number;
}

/** Crea o actualiza el presupuesto de una categoria para un periodo. */
export async function upsertBudget(input: UpsertBudgetInput): Promise<Budget> {
  const { rows } = await query<BudgetRow>(
    `INSERT INTO budgets (
        user_id, category_id, period_year, period_month,
        limit_amount, currency, alert_threshold, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 80), TRUE)
     ON CONFLICT (user_id, category_id, period_year, period_month) DO UPDATE
        SET limit_amount    = EXCLUDED.limit_amount,
            currency        = EXCLUDED.currency,
            alert_threshold = COALESCE($7, budgets.alert_threshold),
            is_active       = TRUE
     RETURNING ${BUDGET_COLUMNS}`,
    [
      input.userId,
      input.categoryId,
      input.periodYear,
      input.periodMonth,
      input.limitAmount,
      input.currency,
      input.alertThreshold ?? null,
    ],
  );

  const row = rows[0];
  if (row === undefined) {
    throw new Error('budgets.repo: la consulta no devolvio la fila esperada.');
  }
  return toBudget(row);
}

/** Presupuesto activo de una categoria en un periodo (o null). */
export async function findActiveForCategory(
  userId: string,
  categoryId: string,
  periodYear: number,
  periodMonth: number,
): Promise<Budget | null> {
  const { rows } = await query<BudgetRow>(
    `SELECT ${BUDGET_COLUMNS}
       FROM budgets
      WHERE user_id = $1
        AND category_id = $2
        AND period_year = $3
        AND period_month = $4
        AND is_active
      LIMIT 1`,
    [userId, categoryId, periodYear, periodMonth],
  );

  const row = rows[0];
  return row === undefined ? null : toBudget(row);
}

/** Presupuestos activos de un usuario en un periodo. */
export async function listActiveForPeriod(
  userId: string,
  periodYear: number,
  periodMonth: number,
): Promise<Budget[]> {
  const { rows } = await query<BudgetRow>(
    `SELECT ${BUDGET_COLUMNS}
       FROM budgets
      WHERE user_id = $1
        AND period_year = $2
        AND period_month = $3
        AND is_active
      ORDER BY created_at`,
    [userId, periodYear, periodMonth],
  );

  return rows.map(toBudget);
}
