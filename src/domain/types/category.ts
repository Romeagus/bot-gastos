/**
 * Entidad de dominio: categoría de gasto.
 * -----------------------------------------------------------------------------
 * Archivo : src/domain/types/category.ts
 *
 * Modela tanto las categorías estándar (globales, sin dueño) como las
 * personalizadas por usuario. La traducción desde las filas SQL es
 * responsabilidad de `src/db/repositories/categories.repo.ts`.
 */

export interface Category {
  readonly id: string;
  /** `null` => categoría estándar/global; con valor => categoría del usuario. */
  readonly userId: string | null;
  /** Identificador estable y legible (ej. 'supermercado'). */
  readonly slug: string;
  readonly name: string;
  readonly emoji: string | null;
  /** `true` => categoría estándar del sistema. */
  readonly isSystem: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Datos para crear una categoría personalizada de un usuario. */
export interface CreateUserCategoryInput {
  readonly userId: string;
  readonly slug: string;
  readonly name: string;
  readonly emoji?: string | null;
}
