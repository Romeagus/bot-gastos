/**
 * Repositorio de usuarios (tabla `users`).
 * -----------------------------------------------------------------------------
 * Archivo : src/db/repositories/users.repo.ts
 *
 * Responsabilidad única: acceso a datos de usuarios. Traduce filas SQL
 * (snake_case) a entidades de dominio (camelCase). No contiene reglas de negocio.
 */

import type { QueryResultRow } from 'pg';
import { query } from '../client.js';
import type { TelegramUserInput, User } from '../../domain/types/user.js';

/** Fila cruda de `users` tal como la devuelve PostgreSQL. */
interface UserRow extends QueryResultRow {
  id: string;
  telegram_id: string; // BIGINT: `pg` lo entrega como string para no perder precisión.
  username: string | null;
  first_name: string | null;
  language_code: string | null;
  currency: string;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Lista de columnas en el orden exacto que espera `toUser`. */
const USER_COLUMNS = `
  id, telegram_id, username, first_name, language_code,
  currency, timezone, is_active, created_at, updated_at
`;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    telegramId: Number(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    languageCode: row.language_code,
    currency: row.currency,
    timezone: row.timezone,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUserOrThrow(row: UserRow | undefined): User {
  if (row === undefined) {
    throw new Error('users.repo: la consulta no devolvió la fila esperada.');
  }
  return toUser(row);
}

/** Busca un usuario por su clave primaria. */
export async function findById(id: string): Promise<User | null> {
  const { rows } = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [
    id,
  ]);
  const row = rows[0];
  return row === undefined ? null : toUser(row);
}

/** Busca un usuario por su `telegram_id`. */
export async function findByTelegramId(telegramId: number): Promise<User | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE telegram_id = $1 LIMIT 1`,
    [telegramId],
  );
  const row = rows[0];
  return row === undefined ? null : toUser(row);
}

/**
 * Alta idempotente desde Telegram: crea el usuario si no existe o refresca sus
 * datos de perfil si ya existe. Es el punto de entrada natural en cada mensaje.
 *
 * Nota: `is_active` no se toca en el UPDATE, de modo que un usuario desactivado
 * no se reactiva por el solo hecho de escribirle al bot.
 */
export async function upsertByTelegramId(input: TelegramUserInput): Promise<User> {
  const { rows } = await query<UserRow>(
    `INSERT INTO users (telegram_id, username, first_name, language_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE
        SET username      = EXCLUDED.username,
            first_name    = EXCLUDED.first_name,
            language_code = EXCLUDED.language_code
     RETURNING ${USER_COLUMNS}`,
    [input.telegramId, input.username ?? null, input.firstName ?? null, input.languageCode ?? null],
  );

  return toUserOrThrow(rows[0]);
}
