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
import { startWeeklyReportJob } from './jobs/weekly-report.job.js';
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

  // Resumen semanal (lunes 10:00). Se apaga con el resto en el shutdown.
  const stopWeeklyReportJob = startWeeklyReportJob(bot);

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info(`Recibida senal ${signal}: apagando...`);

    stopWeeklyReportJob();
    bot.stop(signal);
    await closePool();

    log.info('Apagado ordenado completado');
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const me = await bot.telegram.getMe();
  log.info(`Bot autenticado como @${me.username ?? '(sin username)'}`, { botId: me.id });

  // Menu de comandos nativo de Telegram. Se listan TODOS: el menu es la puerta de
  // entrada al bot para alguien que todavia no conoce los comandos.
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Registrar tu usuario' },
    { command: 'help', description: 'Como usar el bot' },
    { command: 'resumen', description: 'Resumen de como viene el mes' },
    { command: 'presupuesto', description: 'Ver o fijar presupuestos' },
    { command: 'categoria', description: 'Ver o crear categorias' },
    { command: 'borrar', description: 'Borrar un gasto' },
    { command: 'editar', description: 'Corregir un gasto' },
    { command: 'reset', description: 'Empezar de cero' },
  ]);

  // Telegram admite UNA sola instancia por token. Durante un redeploy el
  // contenedor viejo puede tardar en soltar el long polling y el nuevo recibe
  // "409 Conflict"; sin reintentos el proceso muere y entra en loop de reinicios.
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log.info(`Iniciando long polling (intento ${attempt}/${maxAttempts})`);
      // `launch()` resuelve recien cuando el bot se detiene (stop/SIGINT).
      await bot.launch({ dropPendingUpdates: true });
      log.info('Long polling finalizado');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes('409')) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new Error(
          'No se pudo iniciar el long polling: Telegram sigue viendo otra instancia ' +
            `con este token (409). Verificá que no haya otro bot corriendo. (${message})`,
        );
      }

      log.warn('Telegram devolvio 409 (otra instancia todavia activa). Reintento en 5s...');
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
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
