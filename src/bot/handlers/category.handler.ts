/**
 * Handler del comando /categoria.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/category.handler.ts
 *
 * Uso:
 *   /categoria                     -> lista tus categorias
 *   /categoria peluqueria          -> crea la categoria
 *   /categoria gimnasio 🏋️         -> crea la categoria con ese emoji
 *
 * Tambien se puede pedir por chat o por audio ("crea la categoria gimnasio"),
 * que cae en el intent `category_create` de `queries.service`.
 */

import type { Telegraf } from 'telegraf';
import { createUserCategory, listAvailableCategories } from '../../services/categories.service.js';
import type { Category } from '../../domain/types/category.js';
import { createLogger } from '../../utils/logger.js';
import { resolveUser } from './shared.js';

const log = createLogger('bot:category');

/** Un emoji cualquiera dentro de una lista de palabras. */
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/** Linea del listado: '  • 🏋️ Gimnasio  (gimnasio)'. */
function formatCategory(category: Category): string {
  return `  • ${category.emoji ?? '🏷️'} ${category.name}  (${category.slug})`;
}

/** Registra el comando /categoria. */
export function registerCategoryHandler(bot: Telegraf): void {
  bot.command('categoria', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
        return;
      }

      const args = ctx.message.text.trim().split(/\s+/).slice(1);

      // Sin argumentos: listado de categorias disponibles.
      if (args.length === 0) {
        const categories = await listAvailableCategories(user.id);
        const own = categories.filter((category) => !category.isSystem);

        const lines = ['🏷️ Tus categorías:'];
        if (own.length > 0) {
          lines.push('', 'Tuyas:', ...own.map(formatCategory));
        }
        lines.push(
          '',
          'Estándar:',
          ...categories.filter((category) => category.isSystem).map(formatCategory),
          '',
          'Para crear una: /categoria gimnasio',
        );

        await ctx.reply(lines.join('\n'));
        return;
      }

      // Con argumentos: alta. El emoji es opcional y se detecta solo.
      const emoji = args.find((arg) => EMOJI_PATTERN.test(arg)) ?? null;
      const rawName = args.filter((arg) => !EMOJI_PATTERN.test(arg)).join(' ');

      const result = await createUserCategory(user, rawName, emoji);
      await ctx.reply(result.message);
    } catch (error) {
      log.error('Fallo el handler de categoría', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Uhh, algo se me rompió con la categoría 🙈 Probá de nuevo.');
    }
  });
}