/**
 * Configuración de entorno: lectura, validación y tipado de variables de entorno.
 * -----------------------------------------------------------------------------
 * Archivo : src/config/env.ts
 *
 * Responsabilidad única: transformar `process.env` en un objeto tipado y validado.
 * Si falta o es inválida una variable requerida, el proceso falla al arrancar
 * (fail-fast) con un mensaje accionable, en lugar de romper más tarde en runtime.
 *
 * Uso:
 *   import { env } from '../config/env.js';
 *   const token = env.TELEGRAM_BOT_TOKEN;
 */

import 'dotenv/config';
import { z } from 'zod';

/** Niveles de log soportados (los consume el logger de src/utils). */
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  // --- Telegram ---------------------------------------------------------------
  TELEGRAM_BOT_TOKEN: z
    .string()
    .min(1, 'TELEGRAM_BOT_TOKEN no puede estar vacío (ver .env.example).'),

  // --- Base de datos (Supabase / Neon) ---------------------------------------
  // Se normaliza el valor porque los paneles (Railway, etc.) suelen pegar la URL
  // con comillas o saltos de linea, lo que rompia la validacion.
  DATABASE_URL: z
    .string()
    .transform((value) => value.replace(/\s+/g, '').replace(/^["']+|["']+$/g, ''))
    .pipe(
      z.string().superRefine((value, ctx) => {
        if (value === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'DATABASE_URL no puede estar vacío (ver .env.example).',
          });
          return;
        }
        if (!/^postgres(ql)?:\/\//i.test(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'DATABASE_URL debe empezar con postgres:// o postgresql://. Lo recibido empieza con: "' +
              value.slice(0, 12) +
              '"',
          });
        }
      }),
    ),
  // TLS de la conexión: true por defecto (Supabase/Neon lo requieren).
  // Para un Postgres local sin TLS, usar DATABASE_SSL=false.
  DATABASE_SSL: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((value) => value === 'true' || value === '1'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  // --- Groq (transcripción de audio, Whisper) --------------------------------
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY no puede estar vacío (ver .env.example).'),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_WHISPER_MODEL: z.string().min(1).default('whisper-large-v3'),

  // --- Vision (fotos de tickets) ----------------------------------------------
  // Cualquier API compatible con OpenAI que acepte imagenes. Por defecto Groq,
  // que ya es el proveedor del audio: una sola cuenta y una sola key.
  // Para usar OpenRouter en su lugar:
  //   VISION_PROVIDER=openrouter
  //   VISION_BASE_URL=https://openrouter.ai/api/v1
  //   VISION_MODEL=qwen/qwen2.5-vl-72b-instruct
  //   VISION_API_KEY=sk-or-...
  VISION_PROVIDER: z.string().min(1).default('groq'),
  /** Si no se define, se reutiliza GROQ_API_KEY (mismo proveedor por defecto). */
  VISION_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim())),
  VISION_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  VISION_MODEL: z.string().min(1).default('qwen/qwen3.8-27b'),

  // --- Razonamiento (texto -> gasto estructurado) -----------------------------
  // Cualquier API compatible con OpenAI. Por defecto Groq (plan gratuito).
  // Para volver a DeepSeek: REASONING_BASE_URL=https://api.deepseek.com/v1,
  // REASONING_MODEL=deepseek-chat y REASONING_API_KEY=<tu key de DeepSeek>.
  REASONING_PROVIDER: z.string().min(1).default('groq'),
  REASONING_API_KEY: z
    .string()
    .min(1, 'REASONING_API_KEY no puede estar vacío (ver .env.example).'),
  REASONING_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  REASONING_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
});

/** Configuración de entorno tipada. */
export type Env = z.infer<typeof envSchema>;

/** Error lanzado cuando la configuración de entorno es inválida. */
export class EnvValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        'Configuración de entorno inválida:',
        ...issues.map((issue) => `  • ${issue}`),
        '',
        'Revisá tu archivo .env (tomá como base .env.example).',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Valida un conjunto de variables de entorno y devuelve la configuración tipada.
 *
 * @param source Origen de las variables. Por defecto `process.env`.
 * @throws {EnvValidationError} si falta o es inválida alguna variable requerida.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(raíz)';
      return `${key}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }

  return Object.freeze(result.data);
}

/**
 * Configuración ya validada, lista para consumir en el resto de la aplicación.
 * Se evalúa al importar el módulo: si el entorno es inválido, la app no arranca.
 */
export const env: Env = loadEnv();
