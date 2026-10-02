/**
 * Responde al usuario con un mensaje de error que INCLUYE el codigo de registro.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/reply-error.ts
 *
 * Los handlers repiten siempre el mismo patron "perdon, algo se rompio", pero sin
 * dejar rastro. Este helper hace las dos cosas juntas: avisa al usuario y guarda
 * el error con un codigo que puede reportar. Asi, cuando alguien dice "no me
 * anda", hay algo concreto para buscar en vez de adivinar.
 *
 * Fallar aca NO debe romper el flujo: si el guardado falla, se responde igual.
 */

import type { Context } from 'telegraf';
import { reportError, type ErrorSource } from '../services/diagnostics.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('bot:reply-error');

/** Mensajes por origen, para que el texto sea util y no generico. */
const MESSAGES: Record<ErrorSource, string> = {
  text: 'No pude entender eso 🤔',
  audio: 'No pude procesar el audio 🙈',
  photo: 'No pude leer esa imagen 🙈',
  command: 'Algo se me rompió al ejecutar eso 🙈',
  job: 'Algo se me rompió por mi lado 🙈',
  unknown: 'Algo se me rompió 🙈',
};

/**
 * Responde con un error registrado.
 *
 * @param extra.frase  Texto opcional para agregar (ej. "Probá mandarlo de nuevo.").
 */
export async function replyWithError(
  ctx: Context,
  userId: string | null,
  source: ErrorSource,
  error: unknown,
  options: { readonly context?: string; readonly extra?: string } = {},
): Promise<void> {
  const code = await reportError({
    userId,
    source,
    error,
    // OJO: `exactOptionalPropertyTypes` no admite `undefined` explicito en una
    // propiedad opcional, asi que la clave se omite cuando no hay contexto.
    ...(options.context === undefined ? {} : { context: options.context }),
  });

  const lines = [MESSAGES[source]];

  if (options.extra !== undefined) {
    lines.push('', options.extra);
  }

  // El codigo solo se muestra si se pudo guardar: si no, seria una promesa falsa.
  if (code !== null) {
    lines.push('', `Si sigue pasando, contame el código ${code}.`);
  }

  log.debug('Respuesta de error enviada', { source, code });

  await ctx.reply(lines.join('\n'));
}
