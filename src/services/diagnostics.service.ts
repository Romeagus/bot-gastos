/**
 * Diagnostico de errores visibles para el usuario.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/diagnostics.service.ts
 *
 * El problema que resuelve: hoy, cuando algo falla, el unico rastro es el log del
 * servidor. El usuario ve "se me rompio algo", no puede decir mas, y para
 * diagnosticarlo hay que adivinar. Con este modulo cada fallo visible queda
 * guardado con un codigo corto que el usuario puede reportar.
 *
 * Decisiones:
 *   * NO se guarda una fila por cada excepcion: se deduplican por mensaje. Un
 *     bucle que falla 500 veces no llena la tabla de 500 filas iguales.
 *   * El error se registra aunque el guardado falle: el log del servidor sigue
 *     siendo la fuente de verdad. Perder un registro es mejor que romper el
 *     manejo de errores.
 *   * El codigo es corto y legible a proposito: se lo lee por telefono.
 */

import * as errorReports from '../db/repositories/error-reports.repo.js';
import { AiProviderError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('service:diagnostics');

/** Origen del fallo, segun por donde entro el mensaje. */
export type ErrorSource = 'text' | 'audio' | 'photo' | 'command' | 'job' | 'unknown';

/** Caracteres usados para el codigo (sin 0/O/1/I para evitar confusiones). */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

/**
 * Genera un codigo corto a partir de un hash del mensaje.
 *
 * Se deriva del contenido (no es aleatorio) para que el MISMO error siempre
 * tenga el MISMO codigo: asi se puede buscar en los logs por codigo.
 */
export function errorCode(message: string): string {
  // FNV-1a de 32 bits: barato, sin dependencias y estable entre corridas.
  let hash = 0x811c9dc5;
  for (let i = 0; i < message.length; i += 1) {
    hash ^= message.charCodeAt(i);
    // Multiplicacion por el primo de FNV con desplazamiento de bits.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  let code = '';
  let value = hash;
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[value % CODE_ALPHABET.length];
    value = Math.floor(value / CODE_ALPHABET.length);
  }

  return `E-${code}`;
}

/** Normaliza el mensaje para el log: recorta lo que sea enorme. */
function trimMessage(message: string, max = 500): string {
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

/**
 * Registra un error que el usuario ya vio en su chat y devuelve el codigo.
 *
 * @returns El codigo para mostrarle, o `null` si no se pudo guardar.
 */
export async function reportError(params: {
  readonly userId: string | null;
  readonly source: ErrorSource;
  readonly error: unknown;
  readonly context?: string;
}): Promise<string | null> {
  const message =
    params.error instanceof Error ? params.error.message : String(params.error);
  const code = errorCode(message);

  // El log del servidor se escribe siempre, pase lo que pase con la base.
  log.error(`Error visible para el usuario [${code}]`, {
    source: params.source,
    error: trimMessage(message),
    status: params.error instanceof AiProviderError ? params.error.status : undefined,
    // OJO: el proyecto usa `exactOptionalPropertyTypes`, asi que una propiedad
    // opcional no acepta `undefined` explicito: se omite cuando no hay valor.
    ...(params.context === undefined ? {} : { context: params.context }),
  });

  try {
    await errorReports.save({
      code,
      userId: params.userId,
      source: params.source,
      message: trimMessage(message),
      context: params.context === undefined ? null : trimMessage(params.context, 200),
    });
    return code;
  } catch (error) {
    // Si falla el guardado, se avisa pero NO se propaga: el usuario ya tiene su
    // mensaje y el log ya quedo escrito.
    log.warn('No se pudo guardar el reporte de error', {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Errores recientes de un usuario, para el comando /error. */
export async function recentErrors(userId: string, limit = 5): Promise<errorReports.ErrorReport[]> {
  return errorReports.listRecentByUser(userId, limit);
}
