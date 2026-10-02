/**
 * Runner de esquema y semillas.
 * -----------------------------------------------------------------------------
 * Archivo : scripts/apply-schema.ts
 * Uso     : npm run db:apply
 *
 * Aplica, en orden, `db/schema.sql` y luego todos los `db/seeds/*.sql` (orden
 * alfabético). Pensado para entornos sin psql instalado (Windows dev, CI, etc.).
 * Es un utilitario de operación, NO lógica del bot.
 */

import { setDefaultResultOrder } from 'node:dns';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Client } from 'pg';

// Preferir IPv4 (ver comentario en src/db/client.ts).
setDefaultResultOrder('ipv4first');

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');
const schemaPath = path.join(rootDir, 'db', 'schema.sql');
const seedsDir = path.join(rootDir, 'db', 'seeds');

/** Ejecuta el contenido de un archivo SQL dentro de una transacción propia. */
async function runSqlFile(client: Client, filePath: string): Promise<void> {
  const sql = await readFile(filePath, 'utf8');
  const fileName = path.relative(rootDir, filePath);

  process.stdout.write(`→ Aplicando ${fileName} ... `);
  try {
    await client.query(sql);
    process.stdout.write('OK\n');
  } catch (error) {
    process.stdout.write('ERROR\n');
    throw new Error(`Fallo al aplicar ${fileName}: ${(error as Error).message}`, { cause: error });
  }
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('Falta la variable de entorno DATABASE_URL (ver .env.example).');
  }

  // ssl: 'require' es lo esperado en Supabase/Neon; se puede relajar para local.
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

  await client.connect();
  try {
    await runSqlFile(client, schemaPath);

    const seedFiles = (await readdir(seedsDir))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    for (const seedFile of seedFiles) {
      await runSqlFile(client, path.join(seedsDir, seedFile));
    }

    console.log('\n✔ Esquema y semillas aplicados correctamente.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('\n✖ Error aplicando el esquema:', error);
  process.exitCode = 1;
});
