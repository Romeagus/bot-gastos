/**
 * Servicio de razonamiento: texto libre -> gasto estructurado (DeepSeek).
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/reasoning.service.ts
 *
 * Responsabilidad unica: convertir el texto que escribe el usuario en un gasto
 * validado. La normalizacion y la validacion viven en el esquema zod; aca solo
 * se arma el prompt y se delega en el cliente compartido.
 */

import { env } from '../../config/env.js';
import {
  parseParsedExpense,
  type ParsedExpense,
} from '../../domain/schemas/parsed-expense.schema.js';
import {
  FALLBACK_CATEGORY_SLUG,
  PAYMENT_METHODS,
  STANDARD_CATEGORY_SLUGS,
} from '../../domain/types/expense.js';
import { createLogger } from '../../utils/logger.js';
import { chatCompletion } from './openai-compatible.client.js';

const log = createLogger('ai:reasoning');

const SYSTEM_PROMPT = [
  'Sos un extractor de gastos. Recibís un mensaje en español rioplatense y devolvés SOLO un objeto JSON.',
  '',
  'Formato exacto:',
  '{',
  '  "amount": number,             // monto total del gasto, siempre positivo',
  '  "currency": string,           // código ISO 4217 de 3 letras (ej. "ARS", "USD")',
  `  "category_slug": string,      // una de: ${STANDARD_CATEGORY_SLUGS.join(', ')}`,
  '  "merchant": string | null,    // comercio o persona, o null si no se menciona',
  '  "description": string | null, // detalle breve, o null',
  `  "payment_method": string,     // uno de: ${PAYMENT_METHODS.join(', ')}`,
  '  "spent_at": string | null,    // fecha ISO 8601 si se menciona (ej. "2026-09-30"), o null',
  '  "confidence": number          // 0 a 1: qué tan seguro estás de la extracción',
  '}',
  '',
  'Reglas:',
  '- Si el mensaje NO describe un gasto (un saludo, una consulta), devolvé {"amount": 0, "confidence": 0}.',
  '- Si el mensaje habla de FIJAR UN PRESUPUESTO o LIMITE (menciona "presupuesto", "límite", "limitá" o "tope"), NO es un gasto: devolvé {"amount": 0, "confidence": 0}.',
  '- No inventes montos ni comercios que no aparezcan en el mensaje.',
  '- Interpretá los montos en formato local: "3.500,50" es 3500.50 y "3,500.50" es 3500.50.',
  '- Si no se menciona el medio de pago, usá "other".',
  `- Si dudás de la categoría, usá "${FALLBACK_CATEGORY_SLUG}".`,
  '- No agregues texto fuera del JSON.',
].join('\n');

export interface ParseExpenseInput {
  readonly text: string;
  /** Fecha de referencia (ISO) para resolver expresiones como "ayer". */
  readonly today?: string;
  /** Moneda del usuario, usada cuando el mensaje no la menciona. */
  readonly defaultCurrency?: string;
}

/**
 * Interpreta un mensaje de texto y devuelve el gasto estructurado.
 *
 * @returns El gasto normalizado, o `null` si el mensaje no describe un gasto
 *          o la salida del modelo no cumple el contrato.
 * @throws {AiProviderError} si el proveedor falla (red, HTTP, respuesta vacia).
 */
export async function parseExpenseFromText(
  input: ParseExpenseInput,
): Promise<ParsedExpense | null> {
  const context: string[] = [];
  if (input.today !== undefined) {
    context.push(`Fecha de hoy: ${input.today}`);
  }
  if (input.defaultCurrency !== undefined) {
    context.push(`Moneda por defecto: ${input.defaultCurrency}`);
  }
  context.push(`Mensaje del usuario: "${input.text}"`);

  const content = await chatCompletion({
    provider: env.REASONING_PROVIDER,
    apiKey: env.REASONING_API_KEY,
    baseUrl: env.REASONING_BASE_URL,
    model: env.REASONING_MODEL,
    jsonObject: true,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: context.join('\n') },
    ],
  });

  const raw = safeJsonParse(content);
  if (raw === null) {
    log.warn('El modelo no devolvio JSON valido', { content: content.slice(0, 200) });
    return null;
  }

  const parsed = parseParsedExpense(raw);
  if (parsed === null) {
    log.warn('La salida del modelo no cumple el contrato', { raw });
    return null;
  }

  // amount 0 => el modelo considera que el mensaje no describe un gasto.
  if (parsed.amount <= 0) {
    log.debug('El mensaje no describe un gasto', { text: input.text });
    return null;
  }

  return parsed;
}

/** Los modelos a veces envuelven el JSON en ```json ... ```. */
function safeJsonParse(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
