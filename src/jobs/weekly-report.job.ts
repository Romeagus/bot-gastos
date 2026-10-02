/**
 * Resumen semanal programado: los lunes a las 10:00 de la zona del usuario.
 * -----------------------------------------------------------------------------
 * Archivo : src/jobs/weekly-report.job.ts
 *
 * Diseno (por que NO es un `setTimeout` gigante a "el proximo lunes"):
 *
 *   1. El proceso se reinicia seguido (Railway redeploya en cada push) y un
 *      `setTimeout` de 6 dias se pierde con el proceso. Ademas `setTimeout` con
 *      esperas mayores a ~24.8 dias desborda el limite de Node.
 *   2. El reloj del contenedor es UTC y el usuario quiere "10:00 de Argentina".
 *      Argentina es UTC-3 fijo (no aplica horario de verano desde 2009), pero
 *      hardcodear el offset seria fragil ante un usuario en otra zona: la tabla
 *      `users` YA tiene `timezone`. Por eso se resuelve con `Intl`, que conoce
 *      las reglas IANA (incluidos los cambios historicos de horario de verano).
 *   3. Por eso el job TICKEA cada minuto y decide "toca ahora?" en vez de dormir
 *      hasta el disparo: si el proceso estaba caido a las 10:00 y vuelve a las
 *      10:03, el resumen sale igual (dentro de una ventana de cortesia).
 *
 * Idempotencia: el envio se registra en `scheduled_reports` con la clave de la
 * semana ISO, asi que ni un reinicio ni dos ticks seguidos duplican el mensaje.
 *
 * Limite conocido (mismo que el resto de la app): los gastos se filtran por
 * mes en UTC, no por `users.timezone`.
 */

import type { Telegraf } from 'telegraf';
import * as scheduledReports from '../db/repositories/scheduled-reports.repo.js';
import { listActive, updateActive } from '../db/repositories/users.repo.js';
import type { User } from '../domain/types/user.js';
import { buildWeeklyReport } from '../services/weekly-report.service.js';
import { createLogger } from '../utils/logger.js';
import { weeklyPeriodKey } from '../utils/weekly-schedule.js';

const log = createLogger('job:weekly-report');

/** Identificador del job en la tabla `scheduled_reports`. */
export const JOB_NAME = 'weekly_report';

/** Hora de envio en la zona horaria del usuario (0-23). */
export const SEND_HOUR = 10;

/** Minuto exacto de la hora a partir del cual se considera "la hora del resumen". */
const SEND_MINUTE = 0;

/**
 * Ventana de cortesia: si el proceso estuvo caido a las 10:00 y se levanta mas
 * tarde, el resumen se manda igual en vez de perderse hasta la semana que sigue.
 * Se limita a la misma hora (10:00-10:59) para no mandarlo a la tarde.
 */
const GRACE_MINUTES = 59;

/** Cada cuanto se revisa si toca enviar. Un minuto alcanza para no perder nada. */
const TICK_MS = 60_000;

/** Zona por defecto si el usuario no tiene una valida. */

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Que hora es en la zona del usuario, sin depender del reloj del contenedor. */
export function localNow(
  timeZone: string,
  now: Date,
): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  return {
    weekday: WEEKDAYS[read('weekday')] ?? -1,
    // Intl puede devolver "24" para la medianoche en algunos runtimes.
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
  };
}

/**
 * ¿Toca mandarle el resumen a este usuario AHORA?
 *
 * Es una funcion pura (recibe el `now`) para poder testear todos los casos
 * horarios sin tener que esperar al lunes.
 */
export function isDueFor(
  user: Pick<User, 'timezone'>,
  now: Date,
): { due: boolean; periodKey: string } {
  const timeZone = user.timezone === '' ? FALLBACK_TIMEZONE : user.timezone;
  const periodKey = weeklyPeriodKey(now);

  let local: { weekday: number; hour: number; minute: number };
  try {
    local = localNow(timeZone, now);
  } catch (error) {
    // Una zona invalida no debe romper el job: se avisa y se sigue con la de AR.
    log.warn('Zona horaria invalida, se usa la de Argentina', {
      timezone: timeZone,
      error: error instanceof Error ? error.message : String(error),
    });
    local = localNow(FALLBACK_TIMEZONE, now);
  }

  if (local.weekday !== 1) {
    return { due: false, periodKey };
  }

  const elapsed = local.hour * 60 + local.minute - (SEND_HOUR * 60 + SEND_MINUTE);
  const inWindow = elapsed >= 0 && elapsed <= GRACE_MINUTES;

  return { due: inWindow, periodKey };
}


/** Marca al usuario como inactivo (bloqueo el bot). */
async function deactivateUser(userId: string): Promise<void> {
  await updateActive(userId, false).catch((error: unknown) => {
    log.error('No se pudo desactivar al usuario', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Envia el resumen a un usuario, si todavia no se le mando esta semana.
 *
 * @returns `true` si se envio; `false` si ya estaba enviado o no tocaba.
 */
export async function sendToUser(bot: Telegraf, user: User, now: Date): Promise<boolean> {
  const { due, periodKey } = isDueFor(user, now);

  if (!due) {
    return false;
  }

  if (await scheduledReports.wasSent(user.id, JOB_NAME, periodKey)) {
    return false;
  }

  const report = await buildWeeklyReport(user, now);

  // Sin datos no se manda nada: es preferible un silencio a un "no gastaste nada"
  // automatico. Si el usuario vuelve a tener gastos, entra la semana que sigue.
  if (report === null) {
    log.debug('Resumen omitido por no tener datos', { userId: user.id, periodKey });
    return false;
  }

  // Se registra ANTES de enviar: si el envio falla (Telegram caido), el registro
  // igual evita reintentar en bucle. Es el trade-off correcto para un resumen
  // semanal: perder uno es mejor que hacer spam.
  const claimed = await scheduledReports.record(user.id, JOB_NAME, periodKey);
  if (!claimed) {
    return false;
  }

  try {
    await bot.telegram.sendMessage(user.telegramId, report);
    log.info('Resumen semanal enviado', { userId: user.id, periodKey });
    return true;
  } catch (error) {
    // 403 = el usuario bloqueo el bot. Es terminal: se desactiva para no seguir
    // intentandolo cada lunes.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('403') || message.includes('bot was blocked')) {
      log.warn('Usuario bloqueo el bot: se desactiva', { userId: user.id });
      await deactivateUser(user.id);
    } else {
      log.error('Fallo el envio del resumen semanal', { userId: user.id, error: message });
    }
    return false;
  }
}

const FALLBACK_TIMEZONE = 'America/Argentina/Buenos_Aires';


/**
 * Revisa TODOS los usuarios activos y les manda el resumen si toca.
 *
 * @returns cuantos mensajes se enviaron.
 */
export async function runDueReports(bot: Telegraf, now = new Date()): Promise<number> {
  const users = await listActive();
  let sent = 0;

  for (const user of users) {
    try {
      if (await sendToUser(bot, user, now)) {
        sent += 1;
      }
    } catch (error) {
      // Un usuario que falla no puede impedir el resumen de los demas.
      log.error('Error enviando el resumen a un usuario', {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return sent;
}

/**
 * Arranca el job. Devuelve la funcion para detenerlo (la usa el apagado ordenado).
 */
export function startWeeklyReportJob(bot: Telegraf): () => void {
  const timer = setInterval(() => {
    void runDueReports(bot).catch((error: unknown) => {
      log.error('Fallo el tick del resumen semanal', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, TICK_MS);

  // No mantiene el proceso vivo por si solo: si el bot se detiene, el proceso
  // puede terminar limpio en vez de quedar colgado esperando al timer.
  timer.unref();

  log.info('Job de resumen semanal armado', {
    hora: `${String(SEND_HOUR).padStart(2, '0')}:00`,
    zona: 'la del usuario (por defecto America/Argentina/Buenos_Aires)',
  });

  return () => clearInterval(timer);
}
