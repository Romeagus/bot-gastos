/**
 * Handler del comando /help.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/help.handler.ts
 */

import type { Telegraf } from 'telegraf';

export const HELP_TEXT = [
  'Soy tu anotador de gastos 🧾 Te cuento cómo usarme:',
  '',
  '💸 Para anotar un gasto:',
  '  "gasté 3500 en el super" · "pagué 5000 de luz" · "cargué 20 lucas de nafta"',
  '  O mandame un audio o una foto del ticket y lo saco yo.',
  '',
  '📊 Para preguntarme:',
  '  "cuánto gasté este mes" · "cuánto gasté en super"',
  '  "en qué gasté más" · "mis últimos gastos"',
  '',
  '🎯 Para poner topes:',
  '  "presupuesto de 50 lucas en super" · "cómo vienen mis topes"',
  '',
  '🏷️ Para armar tus propias categorías:',
  '  "creá la categoría gimnasio" · "qué categorías tengo"',
  '',
  '📬 Cada lunes a las 10:00 te escribo un resumen de cómo viene el mes.',
  '',
  'Comandos:',
  '  /start       - arrancamos',
  '  /resumen     - el resumen del mes, cuando quieras',
  '  /presupuesto - ver o fijar topes',
  '  /categoria   - ver o crear categorías',
  '  /borrar      - borrar un gasto',
  '  /editar      - corregir un gasto',
  '  /exportar    - bajar todos tus gastos en CSV (Excel)',
  '  /error       - ver los últimos errores que tuviste',
  '  /reset       - empezar de cero',
  '  /help        - esta ayuda',
].join('\n');

/** Registra el comando /help. */
export function registerHelpHandler(bot: Telegraf): void {
  bot.help(async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });
}
