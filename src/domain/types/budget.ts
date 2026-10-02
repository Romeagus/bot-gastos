/**
 * Entidad de dominio: presupuesto mensual por categoria.
 * -----------------------------------------------------------------------------
 * Archivo : src/domain/types/budget.ts
 */

export interface Budget {
  readonly id: string;
  readonly userId: string;
  readonly categoryId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  /** Limite de gasto del periodo. */
  readonly limitAmount: number;
  readonly currency: string;
  /** Porcentaje (1-100) de consumo que dispara la alerta preventiva. */
  readonly alertThreshold: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
