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
  listRecentByUser,
  rejectAllForUser,
  summarizeForUser,
  updateAmountForUser,
  updateCategoryForUser,
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

export interface DeleteResult {
  readonly deleted: boolean;
  readonly expense: Expense | null;
  /** Explicacion cuando no se pudo borrar (para responderle al usuario). */
  readonly reason?: string;
}

/**
 * "Borra" un gasto: lo pasa a `rejected`, que es el borrado logico del dominio.
 *
 * A diferencia de `rejectExpense` (que solo resuelve gastos PENDIENTES del flujo
 * de ticket), esta funciona sobre cualquier gasto vigente: es la accion de
 * "me equivoque, sacalo" pedida desde el chat.
 *
 * Se prefiere el borrado logico a un DELETE: no se destruyen datos del usuario y
 * el gasto igual desaparece de totales, topes y listados.
 */
export async function deleteExpense(userId: string, expenseId: string): Promise<DeleteResult> {
  const expense = await findById(expenseId);

  // El chequeo de dueno es de seguridad: nadie borra gastos ajenos.
  if (expense === null || expense.userId !== userId) {
    return { deleted: false, expense: null, reason: 'No encontré ese gasto.' };
  }

  if (expense.status === 'rejected') {
    return { deleted: false, expense, reason: 'Ese gasto ya estaba borrado.' };
  }

  const updated = await updateStatusForUser(userId, expenseId, 'rejected');
  return updated === null
    ? { deleted: false, expense, reason: 'No pude borrar el gasto.' }
    : { deleted: true, expense: updated };
}

export interface EditResult {
  readonly edited: boolean;
  readonly expense: Expense | null;
  /** Explicacion cuando no se pudo editar (para responderle al usuario). */
  readonly reason?: string;
}

/** Corrige el monto de un gasto. */
export async function editExpenseAmount(
  userId: string,
  expenseId: string,
  amount: number,
): Promise<EditResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      edited: false,
      expense: null,
      reason: 'Ese monto no me sirve: pasame un número mayor a 0.',
    };
  }

  const expense = await findById(expenseId);
  if (expense === null || expense.userId !== userId) {
    return { edited: false, expense: null, reason: 'No encontré ese gasto.' };
  }

  const updated = await updateAmountForUser(userId, expenseId, amount);
  if (updated === null) {
    return { edited: false, expense, reason: 'No pude editar el gasto.' };
  }

  log.info('Gasto editado (monto)', {
    expenseId,
    before: expense.amount,
    after: updated.amount,
  });
  return { edited: true, expense: updated };
}

/** Corrige la categoria de un gasto. */
export async function editExpenseCategory(
  userId: string,
  expenseId: string,
  categoryId: string,
): Promise<EditResult> {
  const expense = await findById(expenseId);
  if (expense === null || expense.userId !== userId) {
    return { edited: false, expense: null, reason: 'No encontré ese gasto.' };
  }

  const updated = await updateCategoryForUser(userId, expenseId, categoryId);
  if (updated === null) {
    return { edited: false, expense, reason: 'No pude editar el gasto.' };
  }

  log.info('Gasto editado (categoria)', {
    expenseId,
    before: expense.categoryId,
    after: updated.categoryId,
  });
  return { edited: true, expense: updated };
}

/** Borra TODOS los gastos vigentes del usuario. @returns cuantos se borraron. */
export async function clearAllExpenses(userId: string): Promise<number> {
  const count = await rejectAllForUser(userId);
  log.info('Gastos borrados en bloque', { userId, count });
  return count;
}

/** Ultimos gastos vigentes, para los listados y los menus del chat. */
export async function listRecentExpenses(userId: string, limit = 5): Promise<Expense[]> {
  return listRecentByUser(userId, limit);
}

/** Cantidad y monto total de los gastos vigentes. */
export async function getExpenseSummary(
  userId: string,
): Promise<{ count: number; total: number }> {
  return summarizeForUser(userId);
}
