/**
 * Claves de periodo para reportes programados.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/weekly-schedule.ts
 *
 * Funciones PURAS (sin base de datos ni Telegram) para poder testear la logica
 * de "semana ISO" sin esperar al lunes ni tocar la red.
 *
 * Se usa la semana ISO-8601 (lunes a domingo) en lugar de un timestamp porque:
 *   * da una clave legible y estable para la tabla `scheduled_reports`;
 *   * dos locales en el mismo instante caen en la MISMA clave si comparten la
 *     zona horaria, que es justo lo que evita duplicados.
 */

/** Devuelve el numero de semana ISO-8601 de una fecha (1-53). */
export function isoWeekNumber(date: Date): number {
  // Se trabaja en UTC para que el resultado no dependa del reloj del contenedor.
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // getUTCDay(): 0 = domingo. Se corre al lunes de esa semana (dias 1..7).
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);

  // El jueves de la semana ISO define el anio al que pertenece la semana.
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);

  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));

  return week;
}

/**
 * Clave del periodo semanal: 'YYYY-Www'.
 *
 * Es la clave de idempotencia del job: mientras dos ejecuciones caigan en la
 * misma semana, generan la misma clave y el segundo envio se descarta.
 */
export function weeklyPeriodKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-W${String(isoWeekNumber(date)).padStart(2, '0')}`;
}
