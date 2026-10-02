/**
 * Logger minimo y tipado (sin dependencias externas).
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/logger.ts
 *
 * Salida legible en desarrollo y JSON por linea en produccion (facilita el
 * parseo por herramientas de logs). El nivel se controla con LOG_LEVEL.
 */

import { env, type Env } from '../config/env.js';

export type LogLevel = Env['LOG_LEVEL'];
export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  fatal: 10,
  error: 20,
  warn: 30,
  info: 40,
  debug: 50,
  trace: 60,
  silent: Number.POSITIVE_INFINITY,
};

let activeLevel: LogLevel = env.LOG_LEVEL;

/** Ajusta el nivel minimo a registrar (util en tests o ajustes en caliente). */
export function setLogLevel(level: LogLevel): void {
  activeLevel = level;
}

export interface Logger {
  fatal(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
}

function write(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[activeLevel]) {
    return;
  }

  const timestamp = new Date().toISOString();
  const stream = level === 'error' || level === 'fatal' ? process.stderr : process.stdout;

  if (env.NODE_ENV === 'production') {
    stream.write(`${JSON.stringify({ timestamp, level, scope, message, ...context })}\n`);
    return;
  }

  const suffix = context === undefined ? '' : ` ${JSON.stringify(context)}`;
  stream.write(`${timestamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${suffix}\n`);
}

/** Crea un logger con un `scope` fijo (normalmente el nombre del modulo). */
export function createLogger(scope: string): Logger {
  return {
    fatal: (message, context) => write('fatal', scope, message, context),
    error: (message, context) => write('error', scope, message, context),
    warn: (message, context) => write('warn', scope, message, context),
    info: (message, context) => write('info', scope, message, context),
    debug: (message, context) => write('debug', scope, message, context),
    trace: (message, context) => write('trace', scope, message, context),
  };
}

/** Logger por defecto para modulos sin scope propio. */
export const logger = createLogger('app');
