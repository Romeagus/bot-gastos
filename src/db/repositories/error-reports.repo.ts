/**
 * Repositorio de errores reportados (tabla `error_reports`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/error-reports.repo.ts
 *
 * Responsabilidad única: guardar y consultar los errores que el usuario ya vio
 * en el chat. No decide qué se registra: eso es del servicio de diagnóstico.
 */

import type { QueryResultRow } from 'pg';
import { query } from '../client.js';

export interface ErrorReport {
  readonly code: string;
  readonly userId: string | null;
  readonly source: string;
  readonly message: string;
  readonly context: string | null;
  readonly createdAt: Date;
}

interface ErrorReportRow extends QueryResultRow {
  code: string;
  user_id: string | null;
  source: string;
  message: string;
  context: string | null;
  created_at: Date;
}

const COLUMNS = 'code, user_id, source, message, context, created_at';

function toErrorReport(row: ErrorReportRow): ErrorReport {
  return {
    code: row.code,
    userId: row.user_id,
    source: row.source,
    message: row.message,
    context: row.context,
    createdAt: row.created_at,
  };
}

export interface SaveErrorInput {
  readonly code: string;
  readonly userId: string | null;
  readonly source: string;
  readonly message: string;
  readonly context: string | null;
}

/**
 * Guarda un error.
 *
 * `ON CONFLICT DO NOTHING` por el codigo: si dos mensajes fallan en el mismo
 * milisegundo y generan el mismo codigo, se guarda una sola vez en vez de tirar
 * un unique violation y perder el error real.
 */
export async function save(input: SaveErrorInput): Promise<void> {
  await query(
    `INSERT INTO error_reports (code, user_id, source, message, context)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (code) DO NOTHING`,
    [input.code, input.userId, input.source, input.message, input.context],
  );
}

/** Ultimos errores de un usuario, del mas reciente al mas antiguo. */
export async function listRecentByUser(userId: string, limit = 5): Promise<ErrorReport[]> {
  const { rows } = await query<ErrorReportRow>(
    `SELECT ${COLUMNS}
       FROM error_reports
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toErrorReport);
}

/** Busca un error puntual por su codigo. */
export async function findByCode(code: string): Promise<ErrorReport | null> {
  const { rows } = await query<ErrorReportRow>(
    `SELECT ${COLUMNS} FROM error_reports WHERE code = $1 LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row === undefined ? null : toErrorReport(row);
}
