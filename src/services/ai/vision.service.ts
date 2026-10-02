/**
 * Servicio de vision: foto de ticket -> gasto estructurado.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/vision.service.ts
 *
 * Responsabilidad unica: extraer un gasto a partir de una imagen. Reutiliza el
 * mismo contrato y esquema zod que el razonamiento por texto, para que aguas
 * abajo (servicio de gastos) el camino sea identico.
 *
 * DOS DECISIONES DE DISENO, ambas comprobadas contra la API real:
 *
 * 1) El monto NO lo interpreta el modelo. Se le pide `amount_text`: el texto del
 *    TOTAL copiado tal cual esta impreso ("19.000"), y lo parsea `parseAmount()`
 *    con las reglas es-AR. Motivo: al pedirle un numero, el modelo devolvia 19
 *    para un ticket de 19.000 (leia el punto como separador decimal, al estilo
 *    ingles) incluso con la regla explicita en el prompt. Transcribir en vez de
 *    interpretar elimina el error de raiz.
 *
 * 2) Se normalizan `category_slug` y `payment_method` en codigo. Los modelos de
 *    vision suelen contestar en ingles ("groceries", "TARJETA DEBITO"), asi que
 *    se mapean con nuestros alias antes de validar.
 */

import { env } from '../../config/env.js';
import {
  parseParsedExpense,
  type ParsedExpense,
} from '../../domain/schemas/parsed-expense.schema.js';
import {
  CATEGORY_HINTS,
  FALLBACK_CATEGORY_SLUG,
  PAYMENT_METHODS,
  STANDARD_CATEGORY_SLUGS,
  type PaymentMethod,
} from '../../domain/types/expense.js';
import { AppError } from '../../utils/errors.js';
import { parseMoneyText } from '../../utils/format.js';
import { createLogger } from '../../utils/logger.js';
import { resolveCategorySlug, slugifyCategory } from '../../utils/nlp.js';
import { chatCompletion } from './openai-compatible.client.js';

const log = createLogger('ai:vision');

/**
 * Credencial efectiva del proveedor de vision. Si no se define `VISION_API_KEY`
 * se reutiliza la de Groq, que es el proveedor por defecto (misma cuenta que el
 * audio: una sola key para todo).
 */
function visionApiKey(): string | null {
  if (env.VISION_API_KEY !== undefined) {
    return env.VISION_API_KEY;
  }
  return env.VISION_PROVIDER.toLowerCase() === 'groq' ? env.GROQ_API_KEY : null;
}

/** Indica si hay credencial para el proveedor de vision configurado. */
export function isVisionConfigured(): boolean {
  return visionApiKey() !== null;
}

/** Catalogo de categorias ofrecidas al modelo (estandar + propias del usuario). */
function buildCategoryCatalog(slugs: readonly string[]): string {
  const hints: Readonly<Record<string, string>> = CATEGORY_HINTS;
  return slugs
    .map((slug) => {
      const hint = hints[slug];
      return hint === undefined
        ? `  - ${slug}: categoría propia del usuario`
        : `  - ${slug}: ${hint}`;
    })
    .join('\n');
}

/** Prompt del extractor de tickets, con el catalogo real de categorias. */
function buildVisionPrompt(categorySlugs: readonly string[]): string {
  return [
    'Sos un extractor de gastos a partir de la FOTO de un ticket o comprobante de Argentina.',
    'Miras la imagen y devolvés SOLO un objeto JSON, sin texto adicional.',
    '',
    '{',
    '  "amount_text": string,        // el TOTAL, copiado tal cual está impreso',
    '  "currency": string,           // código ISO 4217 de 3 letras (ej. "ARS")',
    '  "category_slug": string,      // una de las categorías de la lista de abajo',
    '  "merchant": string | null,    // nombre del comercio',
    '  "description": string | null, // resumen breve de lo comprado',
    `  "payment_method": string,     // uno de: ${PAYMENT_METHODS.join(', ')}`,
    '  "spent_at": string | null,    // fecha del ticket en ISO 8601, o null',
    '  "confidence": number          // 0 a 1: qué tan seguro estás de la extracción',
    '}',
    '',
    'REGLA CRÍTICA DE MONTOS:',
    '- "amount_text" es el TOTAL copiado CARÁCTER POR CARÁCTER, tal como está impreso,',
    '  con sus puntos y comas. NO lo interpretes ni lo conviertas a número.',
    '- Si el ticket dice "19.000" devolvé "amount_text": "19.000" (no 19, no 19000).',
    '- Si dice "$1.234.567,50" devolvé "amount_text": "1234567,50" (sin el signo $).',
    '- Usá la línea que dice TOTAL, nunca el subtotal ni el monto de un ítem.',
    '',
    'Categorías disponibles (elegí SIEMPRE una de estas, con el slug tal cual):',
    buildCategoryCatalog(categorySlugs),
    '',
    'Otras reglas:',
    `- Si dudás de la categoría, usá "${FALLBACK_CATEGORY_SLUG}".`,
    '- Si la imagen NO es un ticket ni un comprobante de pago, devolvé {"amount_text": "0", "confidence": 0}.',
    '- No agregues texto fuera del JSON.',
  ].join('\n');
}

export interface ExtractExpenseFromImageInput {
  readonly image: Uint8Array;
  readonly mimeType: string;
  /** Fecha de referencia (ISO), por si el ticket no tiene fecha legible. */
  readonly today?: string;
  readonly defaultCurrency?: string;
  /** Categorias reales del usuario (estandar + propias) para clasificar. */
  readonly categorySlugs?: readonly string[];
}

/** Payload crudo del modelo, antes de normalizar. */
type RawVisionExpense = Readonly<Record<string, unknown>>;

/** Clave de comparacion: minusculas, sin acentos y con '_' en lugar de espacios. */
function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

/** Traduce el medio de pago que devuelve el modelo a nuestro vocabulario. */
function normalizePaymentMethod(value: unknown): string {
  if (typeof value !== 'string') {
    return 'other';
  }

  const key = normalizeKey(value);
  if ((PAYMENT_METHODS as readonly string[]).includes(key)) {
    return key;
  }

  const aliases: Record<string, PaymentMethod> = {
    efectivo: 'cash',
    debito: 'debit_card',
    tarjeta_debito: 'debit_card',
    debito_automatico: 'debit_card',
    credito: 'credit_card',
    tarjeta_credito: 'credit_card',
    transferencia: 'transfer',
    mercado_pago: 'mercadopago',
    mp: 'mercadopago',
  };
  return aliases[key] ?? 'other';
}

/** Resuelve el monto: primero el texto literal del ticket, luego el numero. */
function resolveAmount(raw: RawVisionExpense): number | null {
  const amountText = raw['amount_text'];
  if (typeof amountText === 'string') {
    const fromText = parseMoneyText(amountText);
    if (fromText !== null && fromText > 0) {
      return fromText;
    }
  }

  const numeric = Number(raw['amount']);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
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
  const apiKey = visionApiKey();
  if (apiKey === null) {
    throw new AppError('La lectura de tickets no está configurada (falta la API key de visión).');
  }

  const categorySlugs =
    input.categorySlugs === undefined || input.categorySlugs.length === 0
      ? STANDARD_CATEGORY_SLUGS
      : input.categorySlugs;

  const dataUrl = `data:${input.mimeType};base64,${Buffer.from(input.image).toString('base64')}`;

  const context: string[] = [];
  if (input.today !== undefined) {
    context.push(`Fecha de hoy: ${input.today}`);
  }
  if (input.defaultCurrency !== undefined) {
    context.push(`Moneda por defecto: ${input.defaultCurrency}`);
  }
  context.push('Extraé el gasto de la imagen adjunta.');

  const content = await chatCompletion({
    provider: `Visión (${env.VISION_PROVIDER})`,
    apiKey,
    baseUrl: env.VISION_BASE_URL,
    model: env.VISION_MODEL,
    jsonObject: true,
    temperature: 0,
    messages: [
      { role: 'system', content: buildVisionPrompt(categorySlugs) },
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
  if (raw === null || typeof raw !== 'object') {
    log.warn('El modelo de vision no devolvio JSON valido', { content: content.slice(0, 200) });
    return null;
  }

  const fields = raw as RawVisionExpense;

  // El monto sale del texto literal del ticket, no de lo que interprete el modelo.
  const amount = resolveAmount(fields);
  if (amount === null) {
    log.debug('La imagen no parece ser un ticket con monto', {
      amountText: fields['amount_text'],
    });
    return null;
  }

  // Categoria y medio de pago se normalizan ANTES de validar: los modelos de
  // vision suelen contestar en ingles ("groceries") o con el texto del ticket
  // ("TARJETA DEBITO"), y el esquema zod solo acepta nuestro vocabulario.
  const rawCategory = fields['category_slug'];
  const categorySlug =
    typeof rawCategory === 'string'
      ? (resolveCategorySlug(rawCategory) ?? slugifyCategory(rawCategory))
      : null;

  const parsed = parseParsedExpense({
    ...fields,
    amount,
    category_slug: categorySlug ?? FALLBACK_CATEGORY_SLUG,
    payment_method: normalizePaymentMethod(fields['payment_method']),
  });

  if (parsed === null) {
    log.warn('La salida del modelo de vision no cumple el contrato', { raw: fields });
    return null;
  }

  log.info('Ticket extraido', {
    amount: parsed.amount,
    category: parsed.category_slug,
    paymentMethod: parsed.payment_method,
  });

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
