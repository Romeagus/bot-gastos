/**
 * Verificacion end-to-end de la base de datos contra un Postgres real.
 * -----------------------------------------------------------------------------
 * Archivo : scripts/verify-db.ts
 * Uso     : npm run db:verify
 *
 * Comprueba:
 *   1. Conectividad y version de PostgreSQL.
 *   2. Que existan las tablas del esquema.
 *   3. Que existan los indices principales.
 *   4. Que las categorias estandar esten sembradas.
 *   5. Lectura: listSystem(), findSystemBySlug(), findById().
 *   6. Escritura: upsertByTelegramId() (idempotente), createForUser() y
 *      listForUser(), con limpieza garantizada en un bloque `finally`.
 *
 * El usuario de prueba usa un telegram_id NEGATIVO (-1): es imposible que
 * colisione con un ID real de Telegram.
 */

import type { QueryResultRow } from 'pg';
import { env } from '../src/config/env.js';
import { closePool, query } from '../src/db/client.js';
import * as categoriesRepo from '../src/db/repositories/categories.repo.js';
import * as usersRepo from '../src/db/repositories/users.repo.js';

const TEST_TELEGRAM_ID = -1;
const TEST_CATEGORY_SLUG = 'verify_temp';
const EXPECTED_TABLES = ['users', 'categories', 'expenses', 'budgets'];

interface NameRow extends QueryResultRow {
  name: string;
}

let failures = 0;

function pass(message: string): void {
  console.log(`  [ok]   ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.log(`  [FAIL] ${message}`);
}

/** Oculta la contrasena de la connection string antes de imprimirla. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '(connection string no parseable)';
  }
}

async function main(): Promise<void> {
  console.log('\n== Verificacion de base de datos ==');
  console.log(`Destino: ${redact(env.DATABASE_URL)}`);
  console.log(`SSL    : ${env.DATABASE_SSL ? 'activado' : 'desactivado'}\n`);

  // 1) Conectividad -----------------------------------------------------------
  console.log('1) Conectividad');
  const { rows: versionRows } = await query<NameRow>('SELECT version() AS name');
  pass(versionRows[0]?.name ?? '(version desconocida)');

  // 2) Tablas -----------------------------------------------------------------
  console.log('\n2) Tablas del esquema');
  const { rows: tableRows = [] } = await query<NameRow>(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [EXPECTED_TABLES],
  );
  const foundTables = new Set(tableRows.map((row) => row.name));
  for (const table of EXPECTED_TABLES) {
    if (foundTables.has(table)) {
      pass(`tabla ${table}`);
    } else {
      fail(`falta la tabla ${table} (ejecutar: npm run db:apply)`);
    }
  }

  // 3) Indices ----------------------------------------------------------------
  console.log('\n3) Indices principales');
  const { rows: indexRows = [] } = await query<NameRow>(
    `SELECT indexname AS name
       FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [EXPECTED_TABLES],
  );
  if (indexRows.length >= 10) {
    pass(`${indexRows.length} indices creados`);
  } else {
    fail(`solo ${indexRows.length} indices (se esperaban >= 10)`);
  }

  // 4) Categorias sembradas ---------------------------------------------------
  console.log('\n4) Categorias estandar');
  const systemCategories = await categoriesRepo.listSystem();
  if (systemCategories.length >= 6) {
    pass(`${systemCategories.length}: ${systemCategories.map((c) => c.slug).join(', ')}`);
  } else {
    fail(`solo ${systemCategories.length} categorias; ejecutar: npm run db:apply`);
  }

  const supermercado = await categoriesRepo.findSystemBySlug('supermercado');
  if (supermercado !== null) {
    pass(`findSystemBySlug('supermercado') -> ${supermercado.name}`);
  } else {
    fail("findSystemBySlug('supermercado') devolvio null");
  }

  const missing = await categoriesRepo.findById('00000000-0000-0000-0000-000000000000');
  if (missing === null) {
    pass('findById(uuid inexistente) -> null');
  } else {
    fail('findById(uuid inexistente) deberia devolver null');
  }

  // 5) Escritura (con limpieza garantizada) -----------------------------------
  console.log('\n5) Escritura (se limpia al final)');
  try {
    const created = await usersRepo.upsertByTelegramId({
      telegramId: TEST_TELEGRAM_ID,
      username: 'verify_bot',
      firstName: 'Verificacion',
      languageCode: 'es',
    });
    pass(`upsertByTelegramId creo el usuario ${created.id}`);

    const again = await usersRepo.upsertByTelegramId({
      telegramId: TEST_TELEGRAM_ID,
      username: 'verify_bot_2',
    });
    if (again.id === created.id) {
      pass(`upsert idempotente: mismo id, username -> "${again.username}"`);
    } else {
      fail('upsert creo un usuario distinto (no es idempotente)');
    }

    const custom = await categoriesRepo.createForUser({
      userId: created.id,
      slug: TEST_CATEGORY_SLUG,
      name: 'Verify Temporal',
      emoji: '🧪',
    });
    pass(`createForUser creo "${custom.slug}" (isSystem=${custom.isSystem})`);

    const visible = await categoriesRepo.listForUser(created.id);
    if (visible.some((category) => category.id === custom.id)) {
      pass(`listForUser devuelve ${visible.length} categorias (incluye la propia)`);
    } else {
      fail('listForUser no incluye la categoria recien creada');
    }
  } finally {
    // ON DELETE CASCADE en categories/expenses/budgets: un solo DELETE alcanza.
    const { rowCount } = await query('DELETE FROM users WHERE telegram_id = $1', [
      TEST_TELEGRAM_ID,
    ]);
    console.log(`  [info] limpieza: ${rowCount ?? 0} usuario(s) de prueba eliminado(s)`);
  }

  console.log(
    failures === 0
      ? '\n== TODO OK: la base esta lista ==\n'
      : `\n== ${failures} verificacion(es) fallaron ==\n`,
  );
  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error('\n[error] La verificacion no pudo completarse:');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    try {
      await closePool();
    } catch (closeError) {
      console.error('[error] No se pudo cerrar el pool:', closeError);
    }
  }
}

void run();
