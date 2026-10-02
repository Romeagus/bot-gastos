/**
 * Logica de negocio de gastos.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/expenses.service.ts
 *
 * Orquesta: gasto interpretado (por IA, vision o texto) -> resolucion de
 * categoria -> persistencia. Los handlers de Telegram llaman aca y no acceden
 * directamente a los repositorios de gastos.
 */

import { findSystemBySlug } from '../db/repositories/categories.repo.js';
import { createExpense } from '../db/repositories/expenses.repo.js';
import type { ParsedExpense } from '../domain/schemas/parsed-expense.schema.js';
import type { Category } from '../domain/types/category.js';
import {
  FALLBACK_CATEGORY_SLUG,
  type Expense,
  type ExpenseSourceType,
} from '../domain/types/expense.js';
import type { User } from '../domain/types/user.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('service:expenses');

export interface BuildExpenseInput {
  readonly user: User;
  readonly parsed: ParsedExpense;
  readonly sourceType: ExpenseSourceType;
  readonly rawInput: string;
  readonly aiModel: string;
  readonly telegramMessageId?: number | null;
  /** Fecha por defecto si el modelo no detecto `spent_at`. */
  readonly fallbackSpentAt?: Date;
}

export interface CreatedExpense {
  readonly expense: Expense;
  readonly category: Category | null;
}

/** Resuelve el slug a una categoria real, con `varios` como ultimo recurso. */
async function resolveCategory(slug: string): Promise<Category | null> {
  const category = await findSystemBySlug(slug);
  if (category !== null) {
    return category;
  }
  return findSystemBySlug(FALLBACK_CATEGORY_SLUG);
}

/**
 * Convierte un gasto interpretado en uno persistido.
 * El monto ya viene validado y normalizado por el esquema zod.
 */
export async function createExpenseFromParsed(input: BuildExpenseInput): Promise<CreatedExpense> {
  const category = await resolveCategory(input.parsed.category_slug);

  const spentAt =
    input.parsed.spent_at !== null && input.parsed.spent_at !== undefined
      ? new Date(input.parsed.spent_at)
      : (input.fallbackSpentAt ?? new Date());

  const expense = await createExpense({
    userId: input.user.id,
    categoryId: category === null ? null : category.id,
    amount: input.parsed.amount,
    currency: input.parsed.currency,
    merchant: input.parsed.merchant,
    description: input.parsed.description,
    paymentMethod: input.parsed.payment_method,
    spentAt,
    sourceType: input.sourceType,
    // El usuario enuncio el gasto y lo registramos: queda confirmado.
    status: 'confirmed',
    rawInput: input.rawInput,
    rawPayload: input.parsed,
    aiModel: input.aiModel,
    aiConfidence: input.parsed.confidence,
    telegramMessageId: input.telegramMessageId ?? null,
  });

  log.info('Gasto registrado', {
    expenseId: expense.id,
    amount: expense.amount,
    category: input.parsed.category_slug,
  });

  return { expense, category };
}
