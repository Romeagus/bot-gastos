/**
 * Handler del comando /start.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/start.handler.ts
 *
 * Da de alta (o actualiza) al usuario en la base y lo saluda. Es la puerta de
 * entrada del bot.
 */

import type { Telegraf } from 'telegraf';
import { upsertByTelegramId } from '../../db/repositories/users.repo.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('bot:start');

/** Registra el comando /start. */
export function registerStartHandler(bot: Telegraf): void {
  bot.start(async (ctx) => {
    const from = ctx.from;

    if (from === undefined) {
      await ctx.reply('No pude identificar tu usuario de Telegram. Proba de nuevo.');
      return;
    }

    const user = await upsertByTelegramId({
      telegramId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      languageCode: from.language_code ?? null,
    });

    log.info('Usuario dado de alta o actualizado', {
      userId: user.id,
      telegramId: user.telegramId,
    });

    await ctx.reply(
      [
        `¡Hola ${user.firstName ?? ''}! 👋 Soy tu anotador de gastos.`,
        '',
        '💸 Registrar:',
        '  "gasté 3500 en el super"  ·  un audio  ·  una foto del ticket',
        '',
        '📊 Consultar:',
        '  "cuánto gasté este mes"  ·  "en qué gasté más"  ·  "mis últimos gastos"',
        '',
        '🎯 Presupuestar:',
        '  "presupuesto de 50 lucas en super"  ·  "mis presupuestos"',
        '',
        `Moneda: ${user.currency} · Zona horaria: ${user.timezone}`,
      ].join('\n'),
    );
  });
}
