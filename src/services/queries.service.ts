/**
 * Cerebro conversacional: interpreta los mensajes que NO son gastos.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/queries.service.ts
 *
 * Estrategia: el LLM NO calcula montos ni redacta la respuesta final (no es
 * confiable con aritmetica ni con datos concretos). Solo clasifica la intencion
 * y extrae parametros; el calculo y el texto los hace el codigo con SQL. Es el
 * patron "texto -> plan -> ejecucion".
 */

import { z } from 'zod';
import { env } from '../config/env.js';
import { listActiveForPeriod, upsertBudget } from '../db/repositories/budgets.repo.js';
import { findSystemBySlug, listSystem } from '../db/repositories/categories.repo.js';
import { listRecentByUser, sumByCategory } from '../db/repositories/expenses.repo.js';
import { STANDARD_CATEGORY_SLUGS } from '../domain/types/expense.js';
import type { User } from '../domain/types/user.js';
import { formatAmount } from '../utils/format.js';
import { createLogger } from '../utils/logger.js';
import { parseMoneyPhrase, resolveCategorySlug } from '../utils/nlp.js';
import { chatCompletion } from './ai/openai-compatible.client.js';

const log = createLogger('service:queries');

const PLAN_SCHEMA = z.object({
  intent: z
    .enum([
      'summary',
      'category_total',
      'top_categories',
      'last_expenses',
      'budget_set',
      'budget_list',
      'capabilities',
      'unknown',
    ])
    .catch('unknown'),
  // Se resuelve con nuestros alias ("super" -> supermercado, "nafta" -> transporte).
  category: z
    .string()
    .transform((value) => resolveCategorySlug(value))
    .catch(null),
  // Monto TAL CUAL lo dijo el usuario: lo parseamos nosotros ("50 lucas" -> 50000).
  amount_text: z.string().trim().min(1).nullable().catch(null),
  period: z.enum(['today', 'this_month', 'last_month', 'this_year']).catch('this_month'),
});

export type QueryPlan = z.infer<typeof PLAN_SCHEMA>;

const SYSTEM_PROMPT = [
  'Sos el cerebro de un bot de gastos personales de Argentina.',
  'Clasificás el mensaje del usuario y devolvés SOLO un objeto JSON:',
  '{',
  '  "intent": "summary" | "category_total" | "top_categories" | "last_expenses" |',
  '            "budget_set" | "budget_list" | "capabilities" | "unknown",',
  '  "category": string | null,    // categoría o sinónimo tal como aparece ("super", "nafta", "luz")',
  '  "amount_text": string | null, // solo si intent="budget_set": el monto tal cual lo dijo ("50 lucas", "50000")',
  '  "period": "today" | "this_month" | "last_month" | "this_year"',
  '}',
  '',
  'Guía de intents:',
  '- "summary": total gastado del período ("cuánto gasté este mes").',
  '- "category_total": total de UNA categoría ("cuánto gasté en super").',
  '- "top_categories": en qué se fue la plata / ranking ("en qué gasté más").',
  '- "last_expenses": quiere ver movimientos ("mis últimos gastos", "qué cargué").',
  '- "budget_set": quiere FIJAR un límite ("presupuesto de 50 lucas en super", "limitá el super a 50000").',
  '- "budget_list": quiere VER sus límites ("mis presupuestos", "cuánto tengo de presupuesto").',
  '- "capabilities": saludo, agradecimiento o pregunta sobre el bot ("hola", "gracias", "qué podés hacer").',
  '- "unknown": cualquier otra cosa.',
  '',
  'Reglas:',
  '- Si no se menciona período, usá "this_month".',
  '- NO calcules montos ni redactes la respuesta: solo clasificás y extraés.',
  '- No agregues texto fuera del JSON.',
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
    : { intent: 'unknown', category: null, amount_text: null, period: 'this_month' };
}

/** Que sabe hacer el bot (para saludos y preguntas generales). */
const CAPABILITIES = [
  '¡Hola! Soy tu anotador de gastos. Podés:',
  '',
  '💸 Registrar: "gasté 3500 en el super", un audio o una foto del ticket.',
  '📊 Consultar: "cuánto gasté este mes", "cuánto gasté en super", "en qué gasté más", "mis últimos gastos".',
  '🎯 Presupuestar: "presupuesto de 50 lucas en super", "mis presupuestos".',
].join('\n');

/** Resumen del periodo + desglose por categoria. */
async function answerSummary(user: User, range: PeriodRange): Promise<string> {
  const totals = await sumByCategory(user.id, range.from, range.to);
  const total = totals.reduce((acc, row) => acc + row.total, 0);

  if (total === 0) {
    return `No tenés gastos registrados ${range.label}.`;
  }

  const categories = await listSystem();
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const detail = totals
    .map(
      (row) =>
        `  • ${names.get(row.categoryId ?? '') ?? 'Sin categoría'}: ${formatAmount(row.total, row.currency)}`,
    )
    .join('\n');

  return [
    `Gastaste ${formatAmount(total, user.currency)} ${range.label}.`,
    '',
    'Por categoría:',
    detail,
  ].join('\n');
}

/** Total de una categoria puntual. */
async function answerCategoryTotal(user: User, slug: string, range: PeriodRange): Promise<string> {
  const category = await findSystemBySlug(slug);
  if (category === null) {
    return `No encontré la categoría "${slug}".`;
  }

  const totals = await sumByCategory(user.id, range.from, range.to);
  const total = totals.find((row) => row.categoryId === category.id)?.total ?? 0;
  const label = `${category.emoji ?? ''} ${category.name}`.trim();

  return total === 0
    ? `No registraste gastos en ${label} ${range.label}.`
    : `Gastaste ${formatAmount(total, user.currency)} en ${label} ${range.label}.`;
}

/** Ranking de categorias por gasto. */
async function answerTopCategories(user: User, range: PeriodRange): Promise<string> {
  const totals = await sumByCategory(user.id, range.from, range.to);
  if (totals.length === 0) {
    return `No tenés gastos registrados ${range.label}.`;
  }

  const categories = await listSystem();
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const lines = totals
    .slice(0, 5)
    .map(
      (row, index) =>
        `  ${index + 1}. ${names.get(row.categoryId ?? '') ?? 'Sin categoría'}: ${formatAmount(row.total, row.currency)}`,
    );

  return [`En qué gastaste más ${range.label}:`, ...lines].join('\n');
}

/** Ultimos movimientos registrados. */
async function answerLastExpenses(user: User): Promise<string> {
  const expenses = await listRecentByUser(user.id, 5);
  if (expenses.length === 0) {
    return 'Todavía no tenés gastos registrados.';
  }

  const categories = await listSystem();
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const lines = expenses.map((expense) => {
    const date = expense.spentAt.toISOString().slice(5, 10).replace('-', '/');
    const label =
      expense.categoryId === null ? 'Sin categoría' : (names.get(expense.categoryId) ?? '?');
    const detail = expense.description ?? expense.merchant;
    return `  • ${date}  ${formatAmount(expense.amount, expense.currency)}  ${label}${detail === null ? '' : ` · ${detail}`}`;
  });

  return ['Tus últimos gastos:', ...lines].join('\n');
}

/** Fija un presupuesto a partir de lenguaje natural. */
async function applyBudgetSet(user: User, plan: QueryPlan): Promise<string> {
  if (plan.category === null) {
    return `¿Para qué categoría? Opciones: ${STANDARD_CATEGORY_SLUGS.join(', ')}.`;
  }

  const amount = plan.amount_text === null ? null : parseMoneyPhrase(plan.amount_text);
  if (amount === null || amount <= 0) {
    return 'No entendí el monto. Ejemplo: "presupuesto de 50 lucas en super".';
  }

  const category = await findSystemBySlug(plan.category);
  if (category === null) {
    return `No encontré la categoría "${plan.category}".`;
  }

  const now = new Date();
  const budget = await upsertBudget({
    userId: user.id,
    categoryId: category.id,
    periodYear: now.getUTCFullYear(),
    periodMonth: now.getUTCMonth() + 1,
    limitAmount: amount,
    currency: user.currency,
  });

  const label = `${category.emoji ?? ''} ${category.name}`.trim();
  return [
    `Listo: presupuesto de ${formatAmount(budget.limitAmount, budget.currency)} para ${label}.`,
    `Te aviso al ${budget.alertThreshold}% y si lo superás.`,
  ].join('\n');
}

/** Lista los presupuestos activos del mes. */
async function answerBudgetList(user: User): Promise<string> {
  const now = new Date();
  const budgets = await listActiveForPeriod(user.id, now.getUTCFullYear(), now.getUTCMonth() + 1);
  if (budgets.length === 0) {
    return [
      'No tenés presupuestos para este mes.',
      'Podés crearlos así: "presupuesto de 50 lucas en super".',
    ].join('\n');
  }

  const categories = await listSystem();
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const lines = budgets.map(
    (budget) =>
      `  • ${names.get(budget.categoryId) ?? '?'}: ${formatAmount(budget.limitAmount, budget.currency)} (aviso al ${budget.alertThreshold}%)`,
  );

  return ['Presupuestos de este mes:', ...lines].join('\n');
}

/**
 * Interpreta un mensaje que NO es un gasto y devuelve la respuesta.
 *
 * @returns El texto a responder, o `null` si no se entendió el mensaje.
 */
export async function handleRequest(user: User, text: string): Promise<string | null> {
  const plan = await buildPlan(text);
  log.debug('Plan de conversación', {
    intent: plan.intent,
    period: plan.period,
    category: plan.category,
  });

  const range = periodRange(plan.period, new Date());

  switch (plan.intent) {
    case 'summary':
      return answerSummary(user, range);
    case 'category_total':
      return plan.category === null
        ? `¿De qué categoría? Opciones: ${STANDARD_CATEGORY_SLUGS.join(', ')}.`
        : answerCategoryTotal(user, plan.category, range);
    case 'top_categories':
      return answerTopCategories(user, range);
    case 'last_expenses':
      return answerLastExpenses(user);
    case 'budget_set':
      return applyBudgetSet(user, plan);
    case 'budget_list':
      return answerBudgetList(user);
    case 'capabilities':
      return CAPABILITIES;
    default:
      return null;
  }
}
