/**
 * Handler de mensajes de voz / audio.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/audio.handler.ts
 *
 * Flujo: descarga del audio de Telegram -> transcripcion (Groq Whisper) ->
 * interpretacion y registro (mismo camino que el texto).
 */

import type { Telegraf } from 'telegraf';
import { transcribeAudio } from '../../services/ai/transcription.service.js';
import { createLogger } from '../../utils/logger.js';
import { logExpenseFromText, resolveUser } from './shared.js';

const log = createLogger('bot:audio');

/** Devuelve un codigo ISO-639-1 ('es') a partir del language_code de Telegram. */
function toIsoLanguage(languageCode: string | null): string {
  return languageCode !== null && languageCode.length >= 2 ? languageCode.slice(0, 2) : 'es';
}

/** Registra el handler de notas de voz. */
export function registerAudioHandler(bot: Telegraf): void {
  bot.on('voice', async (ctx) => {
    try {
      const user = await resolveUser(ctx);
      if (user === null) {
        await ctx.reply('No pude identificar tu usuario de Telegram. Proba de nuevo.');
        return;
      }

      const voice = ctx.message.voice;
      const fileLink = await ctx.telegram.getFileLink(voice.file_id);
      const download = await fetch(fileLink);
      const bytes = new Uint8Array(await download.arrayBuffer());

      const text = await transcribeAudio({
        audio: bytes,
        filename: 'voz.oga',
        mimeType: voice.mime_type ?? 'audio/ogg',
        language: toIsoLanguage(user.languageCode),
      });

      if (text === '') {
        await ctx.reply('No pude entender el audio. Proba grabando de nuevo.');
        return;
      }

      const registered = await logExpenseFromText(ctx, user, text, 'audio', ctx.message.message_id);

      if (!registered) {
        await ctx.reply(`Te entendi: "${text}"\nPero no pude identificar un gasto.`);
      }
    } catch (error) {
      log.error('Fallo el handler de audio', {
        error: error instanceof Error ? error.message : String(error),
      });
      await ctx.reply('Hubo un problema al procesar el audio. Intenta de nuevo en un momento.');
    }
  });
}
