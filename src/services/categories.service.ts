/**
 * Logica de negocio de categorias.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/categories.service.ts
 *
 * Permite que el usuario cree sus propias categorias ("gimnasio", "peluqueria",
 * "jardin") y expone el catalogo disponible (estandar + propias) para que la IA
 * clasifique los gastos con las opciones reales del usuario.
 */

import {
  createForUser,
  listForUser,
  slugExistsForUser,
} from '../db/repositories/categories.repo.js';
import type { Category } from '../domain/types/category.js';
import type { User } from '../domain/types/user.js';
import { emojiForCategory, prettifyCategoryName, slugifyCategory } from '../utils/nlp.js';

/** Tope defensivo: 40 caracteres es lo que permite el slug en el DDL. */
const MAX_NAME_LENGTH = 40;

export interface CreateCategoryResult {
  readonly ok: boolean;
  /** Texto listo para responderle al usuario. */
  readonly message: string;
  readonly category?: Category;
}

/** Categorias visibles para el usuario (estandar + propias). */
export async function listAvailableCategories(userId: string): Promise<Category[]> {
  return listForUser(userId);
}

/**
 * Slugs con los que la IA puede clasificar un gasto de este usuario.
 * Incluye las categorias propias: asi "gasté 8000 en el gimnasio" puede caer
 * en la categoria del usuario en lugar de en "varios".
 */
export async function availableCategorySlugs(userId: string): Promise<string[]> {
  const categories = await listForUser(userId);
  return categories.map((category) => category.slug);
}

/**
 * Crea una categoria propia a partir de un nombre libre.
 * Es idempotente "hacia arriba": si el slug ya existe avisa en lugar de fallar.
 */
export async function createUserCategory(
  user: User,
  rawName: string,
  emoji?: string | null,
): Promise<CreateCategoryResult> {
  const name = rawName.trim().replace(/\s+/g, ' ');

  if (name.length < 2 || slugifyCategory(name) === null) {
    return {
      ok: false,
      message: 'Necesito un nombre para la categoría. Ejemplo: "creá la categoría gimnasio".',
    };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      message: `Ese nombre es muy largo (máximo ${MAX_NAME_LENGTH} caracteres).`,
    };
  }

  const slug = slugifyCategory(name);
  if (slug === null) {
    return { ok: false, message: 'No pude armar el nombre de esa categoría. Probá con otra.' };
  }

  if (await slugExistsForUser(user.id, slug)) {
    return { ok: false, message: `Ya tenés una categoría "${name}" 😉` };
  }

  const category = await createForUser({
    userId: user.id,
    slug,
    name: prettifyCategoryName(name),
    emoji: emoji ?? emojiForCategory(name),
  });

  const label = `${category.emoji ?? ''} ${category.name}`.trim();
  return {
    ok: true,
    message: [
      `¡Listo! Creé la categoría ${label}.`,
      '',
      `Ya podés anotar ahí: "gasté 8000 en ${slug}"`,
      `Y ponerle un tope: "presupuesto de 20 lucas en ${slug}"`,
    ].join('\n'),
    category,
  };
}