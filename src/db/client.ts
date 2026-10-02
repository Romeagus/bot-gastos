/**
 * Cliente de base de datos PostgreSQL: pool de conexiones singleton.
 * -----------------------------------------------------------------------------
 * Archivo : src/db/client.ts
 *
 * Responsabilidad única: administrar el ciclo de vida del Pool de `pg` y exponer
 * helpers de consulta tipados. NO contiene lógica de negocio ni SQL de dominio:
 * eso vive en `src/db/repositories`.
 *
 * Uso:
 *   import { query, withTransaction } from '../db/client.js';
 *   const { rows } = await query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
 */

import { setDefaultResultOrder } from 'node:dns';
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

// Preferir IPv4 al resolver nombres. Muchos hosts (Railway, Render, etc.) no
// tienen salida IPv6, y Supabase publica registros AAAA para la conexion
// directa (`db.<ref>.supabase.co`), lo que produce "connect ENETUNREACH <ipv6>".
// Si el host no tuviera registro A, Node cae igualmente a IPv6.
setDefaultResultOrder('ipv4first');

const log = createLogger('db');

/** Pool singleton. Se crea de forma perezosa en el primer uso. */
let pool: Pool | null = null;

/** Arma la configuración del pool a partir del entorno ya validado. */
function buildPoolConfig(): PoolConfig {
  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    application_name: 'bot-gastos',
  };

  // Supabase/Neon usan certificados gestionados y el pooler suele romper la
  // verificación de cadena con el CA store por defecto de Node. Se habilita TLS
  // sin validar el certificado (la conexión sigue cifrada).
  // Trade-off consciente: si se requiere validación estricta, se debe empaquetar
  // el CA del proveedor y quitar `rejectUnauthorized: false`.
  if (env.DATABASE_SSL) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

/**
 * Devuelve el pool singleton, creándolo en el primer uso.
 * Crear un `Pool` NO abre conexiones: `pg` conecta de forma perezosa en la
 * primera consulta.
 */
export function getPool(): Pool {
  if (pool === null) {
    pool = new Pool(buildPoolConfig());

    // Sin este listener, un error en un cliente inactivo tumbaría el proceso.
    pool.on('error', (error: Error) => {
      log.error('Error en un cliente inactivo del pool', { error: error.message });
    });
  }

  return pool;
}

/**
 * Ejecuta una consulta parametrizada y devuelve el resultado tipado.
 *
 * @param text   SQL con placeholders ($1, $2, ...). Nunca interpolar valores.
 * @param params Parámetros de la consulta (previenen inyección SQL).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, [...params]);
}

/**
 * Ejecuta una función dentro de una transacción (BEGIN / COMMIT / ROLLBACK).
 * Si `fn` lanza, se hace ROLLBACK y se propaga el error original.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // No se enmascara el error original: solo se registra el fallo del ROLLBACK.
      log.error('Fallo el ROLLBACK', { error: (rollbackError as Error).message });
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Verifica la conectividad con la base. Útil en el arranque del bot. */
export async function pingDatabase(): Promise<void> {
  await query('SELECT 1');
}

/** Cierra el pool de forma ordenada e idempotente. Llamar en SIGINT/SIGTERM. */
export async function closePool(): Promise<void> {
  if (pool !== null) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

/**
 * Host de la base (sin usuario ni contrasena), para diagnosticos.
 * Se loguea al arrancar: permite ver en el acto a que servidor se esta
 * conectando el bot sin exponer credenciales.
 */
export function getDatabaseHost(): string {
  try {
    return new URL(env.DATABASE_URL).host;
  } catch {
    return '(DATABASE_URL invalida)';
  }
}
