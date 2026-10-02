/**
 * Punto de entrada del proceso.
 * -----------------------------------------------------------------------------
 * Archivo : src/index.ts
 *
 * Responsabilidad unica: orquestar el arranque y el apagado ordenado.
 *   1. Valida el entorno (al importar `config/env`).
 *   2. Verifica la conexion a PostgreSQL.
 *   3. Construye el bot, registra handlers y arranca el long polling.
 *   4. En SIGINT/SIGTERM detiene el bot y cierra el pool.
 */

import { createBot } from './bot/bot.js';
import { registerHandlers } from './bot/handlers/index.js';
import { env } from './config/env.js';
import { closePool, getDatabaseHost, pingDatabase } from './db/client.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('app');

let shuttingDown = false;

async function main(): Promise<void> {
  const dbHost = getDatabaseHost();
  log.info('Arrancando bot-gastos', { nodeEnv: env.NODE_ENV, dbHost });

  // Diagnostico preventivo: la conexion directa de Supabase es IPv6-only y
  // muchos hosts (Railway, Render) no rutean IPv6 -> "ENETUNREACH".
  if (/^db\..*\.supabase\.co$/i.test(dbHost)) {
    log.warn(
      'DATABASE_URL apunta a la conexion DIRECTA de Supabase (IPv6-only). ' +
        'Si el host no tiene salida IPv6, usar el pooler: ' +
        'aws-0-<region>.pooler.supabase.com (y el usuario postgres.<ref>).',
    );
  }

  await pingDatabase();
  log.info('Conexion a PostgreSQL verificada');

  const bot = createBot();
  registerHandlers(bot);

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info(`Recibida senal ${signal}: apagando...`);

    bot.stop(signal);
    await closePool();

    log.info('Apagado ordenado completado');
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const me = await bot.telegram.getMe();
  log.info(`Bot autenticado como @${me.username ?? '(sin username)'}`, { botId: me.id });

  // Menu de comandos nativo de Telegram.
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Registrar tu usuario' },
    { command: 'help', description: 'Como usar el bot' },
    { command: 'presupuesto', description: 'Ver o fijar presupuestos' },
  ]);

  log.info('Iniciando long polling...');
  // `launch()` resuelve recien cuando el bot se detiene (stop/SIGINT).
  await bot.launch({ dropPendingUpdates: true });
  log.info('Long polling finalizado');
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    log.fatal('Fallo el arranque del bot', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => undefined);
  }
}

void run();
