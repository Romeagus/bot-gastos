/**
 * Servicio de vision: foto de ticket -> gasto estructurado (Qwen2.5-VL).
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/vision.service.ts
 *
 * Responsabilidad unica: extraer un gasto a partir de una imagen. Reutiliza el
 * mismo contrato y esquema zod que el razonamiento por texto, para que aguas
 * abajo (servicio de gastos) el camino sea identico.
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
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { chatCompletion } from './openai-compatible.client.js';

const log = createLogger('ai:vision');

const VISION_SYSTEM_PROMPT = [
  'Sos un extractor de gastos a partir de la FOTO de un ticket o comprobante.',
  'Miras la imagen y devolves SOLO un objeto JSON, sin texto adicional.',
  '',
  'Formato exacto:',
  '{',
  '  "amount": number,             // TOTAL pagado, siempre positivo',
  '  "currency": string,           // codigo ISO 4217 de 3 letras (ej. "ARS")',
  '  "category_slug": string,      // una de: ' + STANDARD_CATEGORY_SLUGS.join(', '),
  '  "merchant": string | null,    // nombre del comercio',
  '  "description": string | null, // resumen breve de lo comprado',
  '  "payment_method": string,     // uno de: ' + PAYMENT_METHODS.join(', '),
  '  "spent_at": string | null,    // fecha del ticket en ISO 8601, o null',
  '  "confidence": number          // 0 a 1: que tan seguro estas de la extraccion',
  '}',
  '',
  'Reglas:',
  '- Usa el TOTAL del ticket, no subtotales ni el monto de un item.',
  '- Si la imagen NO es un ticket ni un comprobante de pago, devolve {"amount": 0, "confidence": 0}.',
  '- Si el ticket trae medio de pago (efectivo, debito, credito), usalo.',
  `- Si dudas de la categoria, usa "${FALLBACK_CATEGORY_SLUG}".`,
  '- No agregues texto fuera del JSON.',
].join('\n');

export interface ExtractExpenseFromImageInput {
  readonly image: Uint8Array;
  readonly mimeType: string;
  /** Fecha de referencia (ISO), por si el ticket no tiene fecha legible. */
  readonly today?: string;
  readonly defaultCurrency?: string;
}

/**
 * Extrae un gasto desde una imagen de ticket.
 *
 * @returns El gasto normalizado, o `null` si la imagen no es un comprobante o
 *          la salida del modelo no cumple el contrato.
 * @throws {AppError} si la vision no esta configurada (falta la API key).
 * @throws {AiProviderError} si el proveedor falla.
 */
export async function extractExpenseFromImage(
  input: ExtractExpenseFromImageInput,
): Promise<ParsedExpense | null> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (apiKey === undefined) {
    throw new AppError('La lectura de tickets no esta configurada (falta OPENROUTER_API_KEY).');
  }

  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.image).toString('base64')}`;

  const context: string[] = [];
  if (input.today !== undefined) {
    context.push('Fecha de hoy: ' + input.today);
  }
  if (input.defaultCurrency !== undefined) {
    context.push('Moneda por defecto: ' + input.defaultCurrency);
  }
  context.push('Extrae el gasto de la imagen adjunta.');

  const content = await chatCompletion({
    provider: 'OpenRouter',
    apiKey,
    baseUrl: env.OPENROUTER_BASE_URL,
    model: env.VISION_MODEL,
    jsonObject: true,
    temperature: 0,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: context.join('\n') },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    timeoutMs: 60_000,
  });

  const raw = safeJsonParse(content);
  if (raw === null) {
    log.warn('El modelo de vision no devolvio JSON valido', { content: content.slice(0, 200) });
    return null;
  }

  const parsed = parseParsedExpense(raw);
  if (parsed === null) {
    log.warn('La salida del modelo de vision no cumple el contrato', { raw });
    return null;
  }

  if (parsed.amount <= 0) {
    log.debug('La imagen no parece ser un ticket con monto');
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
