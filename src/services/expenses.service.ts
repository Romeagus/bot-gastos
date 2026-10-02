/**
 * Logica de negocio de gastos.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/expenses.service.ts
 *
 * Orquesta: gasto interpretado (por IA, vision o texto) -> resolucion de
 * categoria -> persistencia. Los handlers de Telegram llaman aca y no acceden
 * directamente a los repositorios de gastos.
 */

import { findForUserBySlug } from '../db/repositories/categories.repo.js';
import {
  createExpense,
  findById,
  updateStatusForUser,
} from '../db/repositories/expenses.repo.js';
import type { ParsedExpense } from '../domain/schemas/parsed-expense.schema.js';
import type { Category } from '../domain/types/category.js';
import {
  FALLBACK_CATEGORY_SLUG,
  type Expense,
  type ExpenseSourceType,
  type ExpenseStatus,
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
  /**
   * Estado inicial. Por defecto `confirmed`: el usuario escribio o dicto el
   * gasto, asi que esta claro. El flujo de foto de ticket usa `pending` hasta
   * que la persona confirma lo que la IA interpreto.
   */
  readonly status?: ExpenseStatus;
}

export interface CreatedExpense {
  readonly expense: Expense;
  readonly category: Category | null;
}

/**
 * Resuelve el slug a una categoria real (estandar o propia del usuario), con
 * `varios` como ultimo recurso. Tiene en cuenta las categorias personalizadas:
 * un gasto en "peluqueria" se guarda en la categoria del usuario si existe.
 */
async function resolveCategory(userId: string, slug: string): Promise<Category | null> {
  const category = await findForUserBySlug(userId, slug);
  if (category !== null) {
    return category;
  }
  return findForUserBySlug(userId, FALLBACK_CATEGORY_SLUG);
}

/**
 * Convierte un gasto interpretado en uno persistido.
 * El monto ya viene validado y normalizado por el esquema zod.
 */
export async function createExpenseFromParsed(input: BuildExpenseInput): Promise<CreatedExpense> {
  const category = await resolveCategory(input.user.id, input.parsed.category_slug);

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
    status: input.status ?? 'confirmed',
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

export interface StatusChangeResult {
  /** `true` si el estado cambio en este llamado. */
  readonly changed: boolean;
  readonly expense: Expense | null;
  /** Explicacion cuando no se pudo aplicar (para responderle al usuario). */
  readonly reason?: string;
}

/**
 * Aplica un cambio de estado solo si el gasto sigue `pending`.
 *
 * La guarda de `pending` vuelve idempotente al flujo: si el usuario toca dos
 * veces el boton, el segundo toque no produce ningun cambio.
 */
async function changePendingStatus(
  userId: string,
  expenseId: string,
  status: ExpenseStatus,
): Promise<StatusChangeResult> {
  const expense = await findById(expenseId);

  // El chequeo de dueno es de seguridad: el boton no debe tocar gastos ajenos.
  if (expense === null || expense.userId !== userId) {
    return { changed: false, expense: null, reason: 'No encontré ese gasto.' };
  }

  if (expense.status !== 'pending') {
    return { changed: false, expense, reason: 'Ese gasto ya estaba resuelto.' };
  }

  const updated = await updateStatusForUser(userId, expenseId, status);
  return updated === null
    ? { changed: false, expense, reason: 'No pude actualizar el gasto.' }
    : { changed: true, expense: updated };
}

/** Confirma un gasto pendiente (el usuario valido lo que interpreto la IA). */
export async function confirmExpense(
  userId: string,
  expenseId: string,
): Promise<StatusChangeResult> {
  return changePendingStatus(userId, expenseId, 'confirmed');
}

/** Descarta un gasto pendiente (la IA leyo mal o no era un gasto). */
export async function rejectExpense(
  userId: string,
  expenseId: string,
): Promise<StatusChangeResult> {
  return changePendingStatus(userId, expenseId, 'rejected');
}
