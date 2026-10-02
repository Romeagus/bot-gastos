/**
 * Handler del comando /help.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/help.handler.ts
 */

import type { Telegraf } from 'telegraf';

export const HELP_TEXT = [
  'Soy tu anotador de gastos. Podes registrarlos asi:',
  '',
  '✍️ Escribiendo: "gaste 3500 en el super"',
  '🎙️ Mandando una nota de voz',
  '📸 Sacandole una foto a un ticket',
  '',
  'Y preguntarme cosas como:',
  '❓ "cuanto gaste este mes"',
  '❓ "cuanto gaste en supermercado"',
  '',
  'Comandos:',
  '/start - registrar tu usuario',
  '/help - esta ayuda',
  '/presupuesto - ver o fijar presupuestos',
].join('\n');

/** Registra el comando /help. */
export function registerHelpHandler(bot: Telegraf): void {
  bot.help(async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
