/**
 * Deteccion de instrucciones multiples en un mismo mensaje.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/instructions.service.ts
 *
 * Un mensaje (sobre todo de VOZ) puede traer varias ordenes juntas: "gasté 3500
 * en el super y cuánto llevo este mes". El bot las separa y resuelve una por una.
 *
 * Dos cuidados obligados por el limite de tokens/minuto del plan gratuito de
 * Groq (8.000 TPM, comprobado con un HTTP 429 real):
 *   1. Solo se consulta al modelo si el texto PARECE tener mas de una
 *      instruccion (pre-filtro barato): el caso comun no gasta ninguna llamada.
 *   2. Falla en blando: ante cualquier error (incluido 429) se trata el mensaje
 *      como una sola instruccion, en lugar de romper el flujo.
 */

import { z } from 'zod';
import { env } from '../../config/env.js';
import { parseJsonLoose } from '../../utils/json.js';
import { createLogger } from '../../utils/logger.js';
import { chatCompletion } from './openai-compatible.client.js';

const log = createLogger('ai:instructions');

/** Maximo de instrucciones que se resuelven de un mensaje. */
export const MAX_SEGMENTS = 5;

const SPLIT_SCHEMA = z.object({
  multiple: z.boolean().catch(false),
  segments: z.array(z.string().trim().min(1)).max(MAX_SEGMENTS).catch([]),
});

const SPLIT_PROMPT = [
  'Recibís un mensaje de un usuario de un bot de gastos. Puede traer VARIAS instrucciones juntas.',
  'Devolvés SOLO este JSON:',
  '{ "multiple": boolean, "segments": string[] }',
  '',
  'Reglas:',
  '- Si hay UNA sola instrucción, "multiple": false y "segments" con el mensaje COMPLETO, sin agregar nada.',
  '- Si hay VARIAS, "multiple": true y cada instrucción en "segments", como frase completa y autocontenida.',
  '- Se separan también cuando hay VARIOS montos de gastos distintos.',
  '- NO se separa cuando es UN solo gasto con varios ítems ("pagué el gas y la luz" es UNA).',
  `- Máximo ${MAX_SEGMENTS} segmentos.`,
  '',
  'Ejemplos:',
  '"gasté 3500 en el super" -> {"multiple": false, "segments": ["gasté 3500 en el super"]}',
  '"gasté 3500 en el super y 800 de nafta" -> {"multiple": true, "segments": ["gasté 3500 en el super", "anotá 800 de nafta"]}',
  '"gasté 3500 en el super y cuánto gasté este mes" -> {"multiple": true, "segments": ["gasté 3500 en el super", "cuánto gasté este mes"]}',
  '"pagué el gas y la luz" -> {"multiple": false, "segments": ["pagué el gas y la luz"]}',
].join('\n');

/**
 * Conectores que sugieren mas de una instruccion. Es solo un pre-filtro: si no
 * aparece ninguno, no vale la pena gastar una llamada al modelo.
 */
const MULTI_HINT = /,|;|\by\b|tambien|ademas|despues|luego/;

/** Normaliza para el pre-filtro (sin acentos y en minusculas). */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Indica si el texto PODRIA traer varias instrucciones. */
export function looksLikeMultipleInstructions(text: string): boolean {
  return MULTI_HINT.test(normalize(text));
}

/**
 * Parte el mensaje en instrucciones independientes.
 *
 * @returns Las instrucciones (siempre al menos una). Si no parece haber varias,
 *          o si el modelo falla, devuelve `[text]` tal cual.
 */
export async function splitInstructions(text: string): Promise<string[]> {
  if (!looksLikeMultipleInstructions(text)) {
    return [text];
  }

  try {
    const content = await chatCompletion({
      provider: 'Groq (instrucciones)',
      apiKey: env.REASONING_API_KEY,
      baseUrl: env.REASONING_BASE_URL,
      model: env.REASONING_MODEL,
      jsonObject: true,
      temperature: 0,
      messages: [
        { role: 'system', content: SPLIT_PROMPT },
        { role: 'user', content: text },
      ],
    });

    const parsed = SPLIT_SCHEMA.safeParse(parseJsonLoose(content));
    if (!parsed.success || !parsed.data.multiple) {
      return [text];
    }

    const segments = parsed.data.segments.map((segment) => segment.trim()).filter((s) => s !== '');
    return segments.length > 1 ? segments.slice(0, MAX_SEGMENTS) : [text];
  } catch (error) {
    log.warn('No se pudo separar el mensaje en instrucciones', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [text];
  }
}