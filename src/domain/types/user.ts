/**
 * Entidad de dominio: usuario del bot.
 * -----------------------------------------------------------------------------
 * Archivo : src/domain/types/user.ts
 *
 * Tipos "de dominio": camelCase y valores ya normalizados. La traducción desde
 * las filas SQL (snake_case) es responsabilidad exclusiva de
 * `src/db/repositories/users.repo.ts`.
 */

export interface User {
  readonly id: string;
  /**
   * ID numérico de Telegram. Se expone como `number`: los IDs de Telegram están
   * muy por debajo de Number.MAX_SAFE_INTEGER, aunque la columna sea BIGINT.
   */
  readonly telegramId: number;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly languageCode: string | null;
  /** Moneda por defecto del usuario (ISO 4217). */
  readonly currency: string;
  /** Zona horaria IANA (ej. 'America/Argentina/Buenos_Aires'). */
  readonly timezone: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Datos de perfil que llegan desde Telegram.
 * Los campos opcionales se declaran `?: T | null` a propósito: se pueden omitir
 * o pasar `null`, pero NUNCA `undefined` (que `pg` rechazaría como parámetro).
 */
export interface TelegramUserInput {
  readonly telegramId: number;
  readonly username?: string | null;
  readonly firstName?: string | null;
  readonly languageCode?: string | null;
}
