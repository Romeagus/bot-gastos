/**
 * Repositorio de gastos (tabla `expenses`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/expenses.repo.ts
 *
 * Responsabilidad unica: acceso a datos de gastos. Traduce filas SQL a entidades
 * de dominio. No resuelve categorias ni llama a la IA: eso es de los servicios.
 */

import type { QueryResultRow } from 'pg';
import { query } from '../client.js';
import type {
  Expense,
  ExpenseSourceType,
  ExpenseStatus,
  NewExpense,
  PaymentMethod,
} from '../../domain/types/expense.js';

/** Fila cruda de `expenses` tal como la devuelve PostgreSQL. */
interface ExpenseRow extends QueryResultRow {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: string; // NUMERIC: `pg` lo entrega como string para no perder precision.
  currency: string;
  merchant: string | null;
  description: string | null;
  payment_method: string;
  spent_at: Date;
  source_type: string;
  status: string;
  raw_input: string | null;
  raw_payload: unknown;
  ai_model: string | null;
  ai_confidence: string | null;
  telegram_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const EXPENSE_COLUMNS = `
  id, user_id, category_id, amount, currency, merchant, description,
  payment_method, spent_at, source_type, status, raw_input, raw_payload,
  ai_model, ai_confidence, telegram_message_id, created_at, updated_at
`;

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    amount: Number(row.amount),
    currency: row.currency,
    merchant: row.merchant,
    description: row.description,
    // Los CHECK del DDL garantizan estos valores, por eso el cast es seguro.
    paymentMethod: row.payment_method as PaymentMethod,
    spentAt: row.spent_at,
    sourceType: row.source_type as ExpenseSourceType,
    status: row.status as ExpenseStatus,
    rawInput: row.raw_input,
    rawPayload: row.raw_payload,
    aiModel: row.ai_model,
    aiConfidence: row.ai_confidence === null ? null : Number(row.ai_confidence),
    telegramMessageId: row.telegram_message_id === null ? null : Number(row.telegram_message_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExpenseOrThrow(row: ExpenseRow | undefined): Expense {
  if (row === undefined) {
    throw new Error('expenses.repo: la consulta no devolvio la fila esperada.');
  }
  return toExpense(row);
}

/** Inserta un gasto. `raw_payload` (JSONB) se serializa solo. */
export async function createExpense(input: NewExpense): Promise<Expense> {
  const { rows } = await query<ExpenseRow>(
    `INSERT INTO expenses (
        user_id, category_id, amount, currency, merchant, description,
        payment_method, spent_at, source_type, status, raw_input, raw_payload,
        ai_model, ai_confidence, telegram_message_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING ${EXPENSE_COLUMNS}`,
    [
      input.userId,
      input.categoryId,
      input.amount,
      input.currency,
      input.merchant,
      input.description,
      input.paymentMethod,
      input.spentAt,
      input.sourceType,
      input.status,
      input.rawInput,
      input.rawPayload,
      input.aiModel,
      input.aiConfidence,
      input.telegramMessageId,
    ],
  );

  return toExpenseOrThrow(rows[0]);
}

/** Busca un gasto por su clave primaria. */
export async function findById(id: string): Promise<Expense | null> {
  const { rows } = await query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toExpense(row);
}

/**
 * Cambia el estado de un gasto, acotado a su dueno.
 *
 * El filtro por `user_id` no es decorativo: impide que un boton de confirmacion
 * de otra persona pueda modificar un gasto ajeno.
 *
 * @returns El gasto actualizado, o `null` si no existe o no es del usuario.
 */
export async function updateStatusForUser(
  userId: string,
  id: string,
  status: ExpenseStatus,
): Promise<Expense | null> {
  const { rows } = await query<ExpenseRow>(
    `UPDATE expenses
        SET status = $3
      WHERE id = $2 AND user_id = $1
      RETURNING ${EXPENSE_COLUMNS}`,
    [userId, id, status],
  );

  const row = rows[0];
  return row === undefined ? null : toExpense(row);
}

/**
 * Marca como descartados TODOS los gastos vigentes del usuario.
 *
 * Se usa el estado `rejected` en lugar de un DELETE real: el "borrado" queda
 * reversible en la base y desaparece de todos los calculos y listados (que ya
 * excluyen ese estado), asi que para el usuario es indistinguible de borrar.
 *
 * @returns Cuantos gastos se descartaron.
 */
export async function rejectAllForUser(userId: string): Promise<number> {
  const result = await query(
    `UPDATE expenses
        SET status = 'rejected'
      WHERE user_id = $1 AND status <> 'rejected'`,
    [userId],
  );
  return result.rowCount ?? 0;
}

interface ExpenseSummaryRow extends QueryResultRow {
  count: string;
  total: string;
}

/** Cantidad y monto total de los gastos vigentes (los descartados no cuentan). */
export async function summarizeForUser(
  userId: string,
): Promise<{ count: number; total: number }> {
  const { rows } = await query<ExpenseSummaryRow>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM expenses
      WHERE user_id = $1 AND status <> 'rejected'`,
    [userId],
  );

  const row = rows[0];
  return { count: Number(row?.count ?? 0), total: Number(row?.total ?? 0) };
}

/** Cambia el monto de un gasto, acotado a su dueno. */
export async function updateAmountForUser(
  userId: string,
  id: string,
  amount: number,
): Promise<Expense | null> {
  const { rows } = await query<ExpenseRow>(
    `UPDATE expenses
        SET amount = $3
      WHERE id = $2 AND user_id = $1
      RETURNING ${EXPENSE_COLUMNS}`,
    [userId, id, amount],
  );

  const row = rows[0];
  return row === undefined ? null : toExpense(row);
}

/** Cambia la categoria de un gasto, acotado a su dueno. */
export async function updateCategoryForUser(
  userId: string,
  id: string,
  categoryId: string,
): Promise<Expense | null> {
  const { rows } = await query<ExpenseRow>(
    `UPDATE expenses
        SET category_id = $3
      WHERE id = $2 AND user_id = $1
      RETURNING ${EXPENSE_COLUMNS}`,
    [userId, id, categoryId],
  );

  const row = rows[0];
  return row === undefined ? null : toExpense(row);
}

/** Ultimos gastos vigentes de un usuario, del mas reciente al mas antiguo. */
export async function listRecentByUser(userId: string, limit = 10): Promise<Expense[]> {
  const { rows } = await query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expenses
      WHERE user_id = $1
        AND status <> 'rejected'
      ORDER BY spent_at DESC, created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toExpense);
}

/**
 * Todos los gastos vigentes del usuario, para la exportacion a CSV.
 *
 * A diferencia de `listRecentByUser`, NO lleva limite: el objetivo es sacar la
 * cuenta completa. Se excluyen los `rejected` porque exportar tambien lo que el
 * usuario borro daria una contabilidad que no existe.
 */
export async function listAllByUser(userId: string): Promise<Expense[]> {
  const { rows } = await query<ExpenseRow>(
    `SELECT ${EXPENSE_COLUMNS}
       FROM expenses
      WHERE user_id = $1
        AND status <> 'rejected'
      ORDER BY spent_at DESC, created_at DESC`,
    [userId],
  );
  return rows.map(toExpense);
}

/**
 * Total gastado por categoria en un rango de fechas. Lo consumen las alertas
 * de presupuesto y las consultas en lenguaje natural.
 */
export interface CategoryTotal {
  readonly categoryId: string | null;
  readonly currency: string;
  readonly total: number;
}

interface CategoryTotalRow extends QueryResultRow {
  category_id: string | null;
  currency: string;
  total: string;
}

export async function sumByCategory(
  userId: string,
  from: Date,
  to: Date,
): Promise<CategoryTotal[]> {
  const { rows } = await query<CategoryTotalRow>(
    `SELECT category_id, currency, COALESCE(SUM(amount), 0) AS total
       FROM expenses
      WHERE user_id = $1
        AND spent_at >= $2
        AND spent_at < $3
        AND status <> 'rejected'
      GROUP BY category_id, currency
      ORDER BY total DESC`,
    [userId, from, to],
  );

  return rows.map((row) => ({
    categoryId: row.category_id,
    currency: row.currency,
    total: Number(row.total),
  }));
}

interface PeriodCountRow extends QueryResultRow {
  count: string;
  total: string;
  currency: string;
}

/**
 * Cantidad de movimientos y monto total en un rango, agrupado por moneda.
 *
 * Es lo que necesita el resumen semanal: la cantidad de gastos no se puede
 * deducir de `sumByCategory` (esa agrupa por categoria y una misma categoria puede
 * tener muchos movimientos). Se agrupa por moneda para NO sumar ARS con USD: en
 * una tabla mezclada eso daria un numero sin sentido.
 *
 * Mismo criterio que el resto de la app: se excluyen los gastos `rejected`
 * (borrados logicamente).
 */
export async function summarizePeriod(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ count: number; total: number; currency: string }[]> {
  const { rows } = await query<PeriodCountRow>(
    `SELECT currency, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM expenses
      WHERE user_id = $1
        AND spent_at >= $2
        AND spent_at < $3
        AND status <> 'rejected'
      GROUP BY currency`,
    [userId, from, to],
  );

  return rows.map((row) => ({
    count: Number(row.count),
    total: Number(row.total),
    currency: row.currency,
  }));
}
