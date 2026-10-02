/**
 * Validacion de la salida de los modelos de IA para un gasto.
 * -----------------------------------------------------------------------------
 * Archivo : src/domain/schemas/parsed-expense.schema.ts
 *
 * Los modelos NO son confiables: pueden devolver montos como string, categorias
 * inventadas o claves de mas. El esquema es deliberadamente TOLERANTE: lo unico
 * critico es `amount`; el resto se normaliza o cae a un valor por defecto via
 * `.catch(...)`, para no perder un gasto valido por un campo mal formado.
 */

import { z } from 'zod';
import { FALLBACK_CATEGORY_SLUG, PAYMENT_METHODS } from '../types/expense.js';

export const parsedExpenseSchema = z.object({
  /** Monto total, siempre positivo. Unico campo sin valor de fallback. */
  amount: z.coerce.number().nonnegative(),

  currency: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .pipe(z.string().length(3))
    .catch('ARS'),

  /**
   * Slug de categoria. NO se restringe al catalogo estandar: el usuario puede
   * crear categorias propias ("gimnasio", "peluqueria"), y `expenses.service`
   * las resuelve contra las categorias reales del usuario. Si el slug no
   * existe, cae a `varios`. Solo se valida el FORMATO (el DDL exige
   * `^[a-z0-9_]+$` para `categories.slug`).
   */
  category_slug: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9_]{2,40}$/))
    .catch(FALLBACK_CATEGORY_SLUG),

  merchant: z.string().trim().min(1).nullable().catch(null),

  description: z.string().trim().min(1).nullable().catch(null),

  payment_method: z.enum(PAYMENT_METHODS).catch('other'),

  /** Fecha del gasto: cualquier cosa que `Date.parse` entienda (ISO 8601). */
  spent_at: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Fecha no parseable' })
    .nullable()
    .catch(null),

  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

export type ParsedExpense = z.infer<typeof parsedExpenseSchema>;

/**
 * Valida y normaliza la salida cruda de un modelo.
 *
 * @returns El gasto normalizado, o `null` si el JSON es invalido o no cumple el
 *          contrato (en ese caso el llamador decide que hacer con el mensaje).
 */
export function parseParsedExpense(raw: unknown): ParsedExpense | null {
  const result = parsedExpenseSchema.safeParse(raw);
  return result.success ? result.data : null;
}
