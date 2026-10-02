/**
 * Entidad de dominio: gasto.
 * -----------------------------------------------------------------------------
 * Archivo : src/domain/types/expense.ts
 *
 * Define los vocabularios controlados del dominio. Los valores de cada union
 * DEBEN coincidir con las restricciones CHECK de `db/schema.sql`: si se agrega
 * un valor aca, hay que agregarlo tambien en el DDL (y viceversa).
 */

/** Metodos de pago (coincide con expenses_payment_method_chk). */
export const PAYMENT_METHODS = [
  'cash',
  'debit_card',
  'credit_card',
  'transfer',
  'mercadopago',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Vias de captura (coincide con expenses_source_type_chk). */
export const EXPENSE_SOURCE_TYPES = ['audio', 'photo', 'text', 'manual'] as const;
export type ExpenseSourceType = (typeof EXPENSE_SOURCE_TYPES)[number];

/** Estados del registro (coincide con expenses_status_chk). */
export const EXPENSE_STATUSES = ['pending', 'confirmed', 'needs_review', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

/**
 * Slugs de las categorias estandar.
 * IMPORTANTE: deben coincidir con `db/seeds/001_categories.sql`.
 */
export const STANDARD_CATEGORY_SLUGS = [
  'comida',
  'salidas',
  'supermercado',
  'transporte',
  'servicios',
  'varios',
] as const;
export type StandardCategorySlug = (typeof STANDARD_CATEGORY_SLUGS)[number];

/** Slug de ultimo recurso cuando el modelo no puede clasificar el gasto. */
export const FALLBACK_CATEGORY_SLUG: StandardCategorySlug = 'varios';

/** Gasto ya persistido. */
export interface Expense {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string | null;
  /**
   * `NUMERIC(14,2)`: `pg` lo entrega como string, el repositorio lo convierte a
   * number: un monto con 2 decimales es exacto en un double de JS.
   */
  readonly amount: number;
  readonly currency: string;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly spentAt: Date;
  readonly sourceType: ExpenseSourceType;
  readonly status: ExpenseStatus;
  readonly rawInput: string | null;
  readonly rawPayload: unknown;
  readonly aiModel: string | null;
  readonly aiConfidence: number | null;
  readonly telegramMessageId: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Datos necesarios para insertar un gasto. */
export interface NewExpense {
  readonly userId: string;
  readonly categoryId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly merchant: string | null;
  readonly description: string | null;
  readonly paymentMethod: PaymentMethod;
  readonly spentAt: Date;
  readonly sourceType: ExpenseSourceType;
  readonly status: ExpenseStatus;
  readonly rawInput: string | null;
  readonly rawPayload: unknown;
  readonly aiModel: string | null;
  readonly aiConfidence: number | null;
  readonly telegramMessageId: number | null;
}
