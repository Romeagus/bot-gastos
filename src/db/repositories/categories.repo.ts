/**
 * Repositorio de categorías (tabla `categories`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/categories.repo.ts
 *
 * Responsabilidad única: acceso a datos de categorías. Traduce filas SQL
 * (snake_case) a entidades de dominio (camelCase). No contiene reglas de negocio.
 */

import type { QueryResultRow } from 'pg';
import { query } from '../client.js';
import type { Category, CreateUserCategoryInput } from '../../domain/types/category.js';

/** Fila cruda de `categories` tal como la devuelve PostgreSQL. */
interface CategoryRow extends QueryResultRow {
  id: string;
  user_id: string | null;
  slug: string;
  name: string;
  emoji: string | null;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
}

const CATEGORY_COLUMNS = 'id, user_id, slug, name, emoji, is_system, created_at, updated_at';

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCategoryOrThrow(row: CategoryRow | undefined): Category {
  if (row === undefined) {
    throw new Error('categories.repo: la consulta no devolvió la fila esperada.');
  }
  return toCategory(row);
}

/** Categorías estándar (globales). */
export async function listSystem(): Promise<Category[]> {
  const { rows } = await query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE user_id IS NULL ORDER BY name ASC`,
  );
  return rows.map(toCategory);
}

/** Categorías visibles para un usuario: las estándar más las propias. */
export async function listForUser(userId: string): Promise<Category[]> {
  const { rows } = await query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS}
       FROM categories
      WHERE user_id IS NULL OR user_id = $1
      ORDER BY is_system DESC, name ASC`,
    [userId],
  );
  return rows.map(toCategory);
}

/** Busca una categoría por su clave primaria. */
export async function findById(id: string): Promise<Category | null> {
  const { rows } = await query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toCategory(row);
}

/** Resuelve una categoría estándar por su `slug` (ej. 'supermercado'). */
export async function findSystemBySlug(slug: string): Promise<Category | null> {
  const { rows } = await query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS}
       FROM categories
      WHERE user_id IS NULL AND slug = $1
      LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  return row === undefined ? null : toCategory(row);
}

/**
 * Resuelve una categoría visible para el usuario: primero busca una propia con
 * ese slug y, si no existe, cae a la estándar. Así el usuario puede "pisar" el
 * nombre de una categoría del sistema con la suya sin ambigüedad.
 */
export async function findForUserBySlug(userId: string, slug: string): Promise<Category | null> {
  const { rows } = await query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS}
       FROM categories
      WHERE slug = $2 AND (user_id = $1 OR user_id IS NULL)
      ORDER BY (user_id IS NOT NULL) DESC
      LIMIT 1`,
    [userId, slug],
  );
  const row = rows[0];
  return row === undefined ? null : toCategory(row);
}

/** Indica si el usuario ya tiene (o el sistema ya define) ese slug. */
export async function slugExistsForUser(userId: string, slug: string): Promise<boolean> {
  return (await findForUserBySlug(userId, slug)) !== null;
}

/**
 * Crea una categoría personalizada de un usuario.
 * `is_system` se fija en FALSE: la restricción `categories_scope_chk` exige que
 * una categoría con dueño no sea de sistema.
 */
export async function createForUser(input: CreateUserCategoryInput): Promise<Category> {
  const { rows } = await query<CategoryRow>(
    `INSERT INTO categories (user_id, slug, name, emoji, is_system)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING ${CATEGORY_COLUMNS}`,
    [input.userId, input.slug, input.name, input.emoji ?? null],
  );

  return toCategoryOrThrow(rows[0]);
}
