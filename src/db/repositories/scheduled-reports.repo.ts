/**
 * Repositorio de reportes programados (tabla `scheduled_reports`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/scheduled-reports.repo.ts
 *
 * Responsabilidad única: registrar qué reportes programados ya se enviaron. No
 * decide cuándo se envía (eso es del job): solo ofrece el candado para que el
 * envío sea idempotente entre reinicios del proceso.
 */

import { query } from '../client.js';

/** ¿Ya se envió este reporte a este usuario para este periodo? */
export async function wasSent(userId: string, jobName: string, periodKey: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
        SELECT 1 FROM scheduled_reports
         WHERE user_id = $1 AND job_name = $2 AND period_key = $3
       ) AS exists`,
    [userId, jobName, periodKey],
  );
  return rows[0]?.exists === true;
}

/**
 * Registra el envío de un reporte.
 *
 * Usa `ON CONFLICT DO NOTHING` y devuelve si efectivamente lo insertó: eso
 * convierte el registro en un candado atómico. Si dos ticks del scheduler (o dos
 * procesos) intentan enviar el mismo reporte a la vez, solo uno gana y el otro
 * recibe `false`, así que no se mandan duplicados.
 *
 * Motivo del `ON CONFLICT`: entre el `wasSent` y este insert hay una ventana en la
 * que el proceso podría reiniciarse. Es preferible a un error de unique violation.
 */
export async function record(
  userId: string,
  jobName: string,
  periodKey: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `INSERT INTO scheduled_reports (user_id, job_name, period_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, job_name, period_key) DO NOTHING`,
    [userId, jobName, periodKey],
  );
  return (rowCount ?? 0) > 0;
}
