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
import { upsertBudget } from '../db/repositories/budgets.repo.js';
import { findForUserBySlug } from '../db/repositories/categories.repo.js';
import { listRecentByUser, sumByCategory } from '../db/repositories/expenses.repo.js';
import type { Category } from '../domain/types/category.js';
import type { User } from '../domain/types/user.js';
import { formatMoney, formatShortDate } from '../utils/format.js';
import { createLogger } from '../utils/logger.js';
import { parseMoneyPhrase, resolveCategorySlug, slugifyCategory } from '../utils/nlp.js';
import { chatCompletion } from './ai/openai-compatible.client.js';
import {
  deleteBudgetForCategory,
  describeProgress,
  formatBudgetReport,
  getBudgetStatuses,
  getBudgetStatusForCategory,
  periodOf,
} from './budgets.service.js';
import { deleteMostRecentExpense } from './expenses.service.js';
// Se importa con alias para no tocar los usos internos de este modulo.
import {
  categoryLabelMap as categoryLabels,
  createUserCategory,
  listAvailableCategories,
} from './categories.service.js';

const log = createLogger('service:queries');

const PLAN_SCHEMA = z.object({
  intent: z
    .enum([
      'summary',
      'category_total',
      'top_categories',
      'last_expenses',
      'expense_delete_last',
      'expense_clear',
      'budget_set',
      'budget_delete',
      'budget_list',
      'category_create',
      'category_list',
      'capabilities',
      'unknown',
    ])
    .catch('unknown'),
  /**
   * Categoria mencionada. Se normaliza en dos pasos: primero los alias
   * ("super" -> supermercado) y, si no matchea, un slug libre que despues se
   * resuelve contra las categorias REALES del usuario (propias incluidas).
   */
  category: z
    .string()
    .transform((value) => resolveCategorySlug(value) ?? slugifyCategory(value))
    .catch(null),
  // Monto TAL CUAL lo dijo el usuario: lo parseamos nosotros ("50 lucas" -> 50000).
  amount_text: z.string().trim().min(1).nullable().catch(null),
  // Nombre de la categoria a crear, tal cual lo dijo ("gimnasio", "jardin").
  category_name: z.string().trim().min(2).nullable().catch(null),
  period: z.enum(['today', 'this_month', 'last_month', 'this_year']).catch('this_month'),
});

export type QueryPlan = z.infer<typeof PLAN_SCHEMA>;

const SYSTEM_PROMPT = [
  'Sos el cerebro de un bot de gastos personales de Argentina. Hablás relajado, en segunda persona ("vos").',
  'Clasificás el mensaje del usuario y devolvés SOLO un objeto JSON:',
  '{',
  '  "intent": "summary" | "category_total" | "top_categories" | "last_expenses" |',
  '            "expense_delete_last" | "expense_clear" |',
  '            "budget_set" | "budget_delete" | "budget_list" |',
  '            "category_create" | "category_list" | "capabilities" | "unknown",',
  '  "category": string | null,      // categoría o sinónimo tal como aparece ("super", "nafta", "gimnasio")',
  '  "amount_text": string | null,   // solo si intent="budget_set": el monto tal cual lo dijo ("50 lucas", "50000")',
  '  "category_name": string | null, // solo si intent="category_create": el NOMBRE de la categoría nueva',
  '  "period": "today" | "this_month" | "last_month" | "this_year"',
  '}',
  '',
  'Guía de intents:',
  '- "summary": total gastado del período ("cuánto gasté este mes").',
  '- "category_total": total de UNA categoría ("cuánto gasté en super").',
  '- "top_categories": en qué se fue la plata / ranking ("en qué gasté más").',
  '- "last_expenses": quiere ver movimientos ("mis últimos gastos", "qué cargué").',
  '- "expense_delete_last": quiere BORRAR el último gasto ("borrá el último", "eliminá el último que anoté").',
  '- "expense_clear": quiere borrar TODOS sus gastos ("borrá todo", "quiero empezar de cero").',
  '- "budget_set": quiere FIJAR un límite ("presupuesto de 50 lucas en super").',
  '- "budget_delete": quiere BORRAR un tope ("borrá el tope de super", "sacá el presupuesto de nafta").',
  '- "budget_list": quiere VER sus límites ("mis presupuestos", "cuánto me queda de super").',
  '- "category_create": quiere CREAR una categoría nueva ("creá la categoría gimnasio").',
  '- "category_list": quiere VER sus categorías ("qué categorías tengo", "mis categorías").',
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
        label: 'este año',
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
    : {
        intent: 'unknown',
        category: null,
        amount_text: null,
        category_name: null,
        period: 'this_month',
      };
}

/** Que sabe hacer el bot (para saludos y preguntas generales). */
const CAPABILITIES = [
  '¡Hola! 👋 Soy tu anotador de gastos. Te doy una mano con esto:',
  '',
  '💸 Anotar: "gasté 3500 en el super" · un audio 🎙️ · una foto del ticket 📸',
  '📊 Ver: "cuánto gasté este mes" · "en qué gasté más" · "mis últimos gastos"',
  '🎯 Topes: "presupuesto de 50 lucas en super" · "cómo vienen mis topes"',
  '🏷️ Categorías: "creá la categoría gimnasio" · "qué categorías tengo"',
  '',
  'Y si me mandás un audio, también entiendo todo esto 😉',
].join('\n');

/** Resumen del periodo + desglose por categoria. */
async function answerSummary(user: User, range: PeriodRange): Promise<string> {
  const totals = await sumByCategory(user.id, range.from, range.to);
  const total = totals.reduce((acc, row) => acc + row.total, 0);

  if (total === 0) {
    return `Todavía no anotaste ningún gasto ${range.label} 🤷`;
  }

  const names = await categoryLabels(user.id);
  const detail = totals
    .map(
      (row) =>
        `  • ${names.get(row.categoryId ?? '') ?? 'Sin categoría'}: ${formatMoney(row.total, row.currency)}`,
    )
    .join('\n');

  return [
    `💸 Gastaste ${formatMoney(total, user.currency)} ${range.label}.`,
    '',
    'Así se repartió:',
    detail,
  ].join('\n');
}

/** Total de una categoria puntual. */
async function answerCategoryTotal(user: User, slug: string, range: PeriodRange): Promise<string> {
  const category = await findForUserBySlug(user.id, slug);
  if (category === null) {
    return `No tengo ninguna categoría "${slug}" 🤔 Si querés te la creo: "creá la categoría ${slug}".`;
  }

  const totals = await sumByCategory(user.id, range.from, range.to);
  const total = totals
    .filter((row) => row.categoryId === category.id)
    .reduce((acc, row) => acc + row.total, 0);
  const label = `${category.emoji ?? ''} ${category.name}`.trim();

  return total === 0
    ? `No anotaste gastos en ${label} ${range.label}.`
    : `💸 Te gastaste ${formatMoney(total, user.currency)} en ${label} ${range.label}.`;
}

/** Ranking de categorias por gasto. */
async function answerTopCategories(user: User, range: PeriodRange): Promise<string> {
  const totals = await sumByCategory(user.id, range.from, range.to);
  if (totals.length === 0) {
    return `Todavía no anotaste ningún gasto ${range.label} 🤷`;
  }

  const names = await categoryLabels(user.id);
  const lines = totals
    .slice(0, 5)
    .map(
      (row, index) =>
        `  ${index + 1}. ${names.get(row.categoryId ?? '') ?? 'Sin categoría'} · ${formatMoney(row.total, row.currency)}`,
    );

  return [`🏆 En qué se te fue la plata ${range.label}:`, ...lines].join('\n');
}

/** Ultimos movimientos registrados. */
async function answerLastExpenses(user: User): Promise<string> {
  const expenses = await listRecentByUser(user.id, 5);
  if (expenses.length === 0) {
    return 'Todavía no anotaste ningún gasto. Arrancá con "gasté 3500 en el super" 😉';
  }

  const names = await categoryLabels(user.id);
  const lines = expenses.map((expense) => {
    const date = formatShortDate(expense.spentAt);
    const label =
      expense.categoryId === null ? 'Sin categoría' : (names.get(expense.categoryId) ?? '?');
    const detail = expense.description ?? expense.merchant;
    return `  • ${date} · ${formatMoney(expense.amount, expense.currency)} · ${label}${detail === null ? '' : ` (${detail})`}`;
  });

  return ['🧾 Tus últimos movimientos:', ...lines].join('\n');
}

/** Fija un tope a partir de lenguaje natural. */
async function applyBudgetSet(user: User, plan: QueryPlan): Promise<string> {
  if (plan.category === null) {
    const categories = await listAvailableCategories(user.id);
    return [
      '¿A qué categoría le pongo el tope?',
      `Tengo: ${categories.map((category) => category.slug).join(', ')}.`,
      'Y si te falta una, la creamos: "creá la categoría gimnasio".',
    ].join('\n');
  }

  const amount = plan.amount_text === null ? null : parseMoneyPhrase(plan.amount_text);
  if (amount === null || amount <= 0) {
    return 'No te entendí el monto 😅 Probá así: "presupuesto de 50 lucas en super".';
  }

  const category = await findForUserBySlug(user.id, plan.category);
  if (category === null) {
    return [
      `No tengo ninguna categoría "${plan.category}" 🤔`,
      `Si querés te la creo: "creá la categoría ${plan.category}".`,
    ].join('\n');
  }

  const { year, month } = periodOf(new Date());
  const budget = await upsertBudget({
    userId: user.id,
    categoryId: category.id,
    periodYear: year,
    periodMonth: month,
    limitAmount: amount,
    currency: user.currency,
  });

  const label = `${category.emoji ?? ''} ${category.name}`.trim();
  const lines = [`🎯 Listo, tope de ${formatMoney(budget.limitAmount, budget.currency)} en ${label}.`];

  // Si ya tenia gastos este mes en esa categoria se lo muestro al toque: asi ve
  // que el tope cuenta desde el primer momento.
  const status = await getBudgetStatusForCategory(user.id, category.id, year, month);
  if (status !== null && status.spent > 0) {
    lines.push(`Ojo que ya ${describeProgress(status)}.`);
  }
  lines.push(`Te aviso cuando llegues al ${budget.alertThreshold}% y si lo pasás.`);

  return lines.join('\n');
}

/** Muestra como vienen los topes del mes: gastado, restante y porcentaje. */
async function answerBudgetList(user: User): Promise<string> {
  const { year, month } = periodOf(new Date());
  const statuses = await getBudgetStatuses(user.id, year, month);

  if (statuses.length === 0) {
    return [
      'Todavía no tenés topes para este mes 🤷',
      '',
      'Creá uno así: "presupuesto de 50 lucas en super".',
      'Y si te falta la categoría: "creá la categoría gimnasio".',
    ].join('\n');
  }

  return formatBudgetReport(statuses, 'este mes');
}

/** Crea una categoria propia a partir de lenguaje natural. */
async function applyCategoryCreate(user: User, plan: QueryPlan): Promise<string> {
  const name = plan.category_name ?? plan.category;
  if (name === null) {
    return '¿Cómo querés llamar la categoría? Ejemplo: "creá la categoría gimnasio".';
  }

  const result = await createUserCategory(user, name);
  return result.message;
}

/** Lista las categorias disponibles para el usuario (estandar + propias). */
async function answerCategoryList(user: User): Promise<string> {
  const categories = await listAvailableCategories(user.id);
  const own = categories.filter((category) => !category.isSystem);

  const line = (category: Category): string => `  • ${category.emoji ?? '🏷️'} ${category.name}`;

  const lines = ['🏷️ Tus categorías:', ''];
  if (own.length > 0) {
    lines.push('Tuyas:', ...own.map(line), '');
  }
  lines.push('Estándar:', ...categories.filter((c) => c.isSystem).map(line));
  lines.push('', 'Podés crear más: "creá la categoría gimnasio".');

  return lines.join('\n');
}

/** Respuesta cuando falta decir de que categoria se esta hablando. */
async function answerMissingCategory(user: User): Promise<string> {
  const categories = await listAvailableCategories(user.id);
  return [
    '¿De qué categoría hablamos? Tengo estas:',
    categories.map((category) => `  • ${category.emoji ?? '🏷️'} ${category.name}`).join('\n'),
  ].join('\n');
}

/** Borra el gasto mas reciente ("borrá el último"). */
async function applyDeleteLastExpense(user: User): Promise<string> {
  const result = await deleteMostRecentExpense(user.id);

  if (!result.deleted || result.expense === null) {
    return result.reason ?? 'No pude borrar el último gasto.';
  }

  const expense = result.expense;
  return `🗑️ Listo, borré ${formatMoney(expense.amount, expense.currency)} del ${formatShortDate(expense.spentAt)}.`;
}

/**
 * El usuario pidio borrar TODO: se lo deriva al comando `/reset`.
 *
 * Un pedido de esta magnitud no debe depender de que el clasificador haya
 * entendido bien el mensaje: se hace por comando y con confirmacion por botones,
 * nunca a partir de un texto suelto.
 */
function answerClearExpenses(): string {
  return [
    '⚠️ Para borrar todo quiero que me lo confirmes con un botón.',
    '',
    'Escribí /reset y te muestro las opciones.',
  ].join('\n');
}

/** Borra el tope de una categoria. */
async function applyBudgetDelete(user: User, plan: QueryPlan): Promise<string> {
  if (plan.category === null) {
    return answerMissingCategory(user);
  }

  const category = await findForUserBySlug(user.id, plan.category);
  if (category === null) {
    return `No tengo ninguna categoría "${plan.category}" 🤔`;
  }

  const { year, month } = periodOf(new Date());
  const deleted = await deleteBudgetForCategory(user.id, category.id, year, month);
  const label = `${category.emoji ?? ''} ${category.name}`.trim();

  return deleted
    ? `🧹 Listo, borré el tope de ${label}.`
    : `No tenías ningún tope en ${label} este mes.`;
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
        ? answerMissingCategory(user)
        : answerCategoryTotal(user, plan.category, range);
    case 'top_categories':
      return answerTopCategories(user, range);
    case 'last_expenses':
      return answerLastExpenses(user);
    case 'expense_delete_last':
      return applyDeleteLastExpense(user);
    case 'expense_clear':
      return answerClearExpenses();
    case 'budget_set':
      return applyBudgetSet(user, plan);
    case 'budget_delete':
      return applyBudgetDelete(user, plan);
    case 'budget_list':
      return answerBudgetList(user);
    case 'category_create':
      return applyCategoryCreate(user, plan);
    case 'category_list':
      return answerCategoryList(user);
    case 'capabilities':
      return CAPABILITIES;
    default:
      return null;
  }
}
