/**
 * Consultas en lenguaje natural sobre los gastos registrados.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/queries.service.ts
 *
 * Estrategia: el LLM NO calcula montos (no es confiable para aritmetica). Solo
 * clasifica la intencion y extrae parametros; el calculo lo hace SQL. Es el
 * patron "texto -> plan -> ejecucion".
 */

import { z } from 'zod';
import { env } from '../config/env.js';
import { findSystemBySlug, listSystem } from '../db/repositories/categories.repo.js';
import { sumByCategory } from '../db/repositories/expenses.repo.js';
import { STANDARD_CATEGORY_SLUGS } from '../domain/types/expense.js';
import type { User } from '../domain/types/user.js';
import { createLogger } from '../utils/logger.js';
import { formatAmount } from '../utils/format.js';
import { chatCompletion } from './ai/openai-compatible.client.js';

const log = createLogger('service:queries');

const PLAN_SCHEMA = z.object({
  intent: z.enum(['summary', 'category', 'unknown']).catch('unknown'),
  category_slug: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(STANDARD_CATEGORY_SLUGS))
    .nullable()
    .catch(null),
  period: z.enum(['today', 'this_month', 'last_month', 'this_year']).catch('this_month'),
});

export type QueryPlan = z.infer<typeof PLAN_SCHEMA>;

const SYSTEM_PROMPT = [
  'Clasificas consultas sobre gastos personales. Devolves SOLO un objeto JSON:',
  '{',
  '  "intent": "summary" | "category" | "unknown",',
  '  "category_slug": string | null,   // solo si intent = "category"; una de: ' +
    STANDARD_CATEGORY_SLUGS.join(', '),
  '  "period": "today" | "this_month" | "last_month" | "this_year"',
  '}',
  '',
  'Reglas:',
  '- "summary" = quiere el total gastado (sin importar categoria).',
  '- "category" = quiere el total de una categoria concreta.',
  '- "unknown" = no es una consulta de gastos (saludo, otra cosa).',
  '- Si no se menciona periodo, usa "this_month".',
  '- No devuelvas ningun texto fuera del JSON.',
].join('\n');

interface PeriodRange {
  readonly from: Date;
  readonly to: Date;
  readonly label: string;
}

/** Rango [inicio, fin) del periodo pedido, en UTC. */
function periodRange(period: QueryPlan['period'], now: Date): PeriodRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  switch (period) {
    case 'today': {
      const from = new Date(Date.UTC(year, month, now.getUTCDate()));
      return { from, to: new Date(from.getTime() + 86_400_000), label: 'hoy' };
    }
    case 'last_month': {
      return {
        from: new Date(Date.UTC(year, month - 1, 1)),
        to: new Date(Date.UTC(year, month, 1)),
        label: 'el mes pasado',
      };
    }
    case 'this_year': {
      return {
        from: new Date(Date.UTC(year, 0, 1)),
        to: new Date(Date.UTC(year + 1, 0, 1)),
        label: 'este ano',
      };
    }
    case 'this_month':
    default: {
      return {
        from: new Date(Date.UTC(year, month, 1)),
        to: new Date(Date.UTC(year, month + 1, 1)),
        label: 'este mes',
      };
    }
  }
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

/** Obtiene el plan de consulta desde el LLM. */
async function buildPlan(text: string): Promise<QueryPlan> {
  const content = await chatCompletion({
    provider: env.REASONING_PROVIDER,
    apiKey: env.REASONING_API_KEY,
    baseUrl: env.REASONING_BASE_URL,
    model: env.REASONING_MODEL,
    jsonObject: true,
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'Consulta: "' + text + '"' },
    ],
  });

  const parsed = PLAN_SCHEMA.safeParse(safeJsonParse(content));
  return parsed.success
    ? parsed.data
    : { intent: 'unknown', category_slug: null, period: 'this_month' };
}

/**
 * Responde una pregunta sobre los gastos.
 *
 * @returns El texto de respuesta, o `null` si el mensaje no era una consulta.
 */
export async function answerQuestion(user: User, text: string): Promise<string | null> {
  const plan = await buildPlan(text);
  log.debug('Plan de consulta', { intent: plan.intent, period: plan.period });
  if (plan.intent === 'unknown') {
    return null;
  }

  const range = periodRange(plan.period, new Date());
  const totals = await sumByCategory(user.id, range.from, range.to);

  if (plan.intent === 'summary') {
    const total = totals.reduce((acc, row) => acc + row.total, 0);
    if (total === 0) {
      return `No tenes gastos registrados ${range.label}.`;
    }
    const categories = await listSystem();
    const names = new Map(categories.map((category) => [category.id, category.name]));
    const detalle = totals
      .map(
        (row) =>
          `  - ${names.get(row.categoryId ?? '') ?? 'Sin categoria'}: ${formatAmount(row.total, row.currency)}`,
      )
      .join('\n');
    return [
      `Gastaste ${formatAmount(total, user.currency)} ${range.label}.`,
      '',
      'Por categoria:',
      detalle,
    ].join('\n');
  }

  // intent === 'category'
  if (plan.category_slug === null) {
    return null;
  }

  const category = await findSystemBySlug(plan.category_slug);
  if (category === null) {
    return null;
  }

  const row = totals.find((item) => item.categoryId === category.id);
  const total = row?.total ?? 0;
  const label = `${category.emoji ?? ''} ${category.name}`.trim();

  if (total === 0) {
    return `No registraste gastos en ${label} ${range.label}.`;
  }

  return `Gastaste ${formatAmount(total, user.currency)} en ${label} ${range.label}.`;
}
