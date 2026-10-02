/**
 * Handler de mensajes de voz / audio.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/handlers/audio.handler.ts
 *
 * Flujo: descarga del audio de Telegram -> transcripcion (Groq Whisper) ->
 * interpretacion y registro (mismo camino que el texto).
 */

import type { Context, Telegraf } from 'telegraf';
import { transcribeAudio } from '../../services/ai/transcription.service.js';
import { AiProviderError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import { handleFreeText, resolveUser } from './shared.js';

const log = createLogger('bot:audio');

/** Datos minimos que necesitamos de un `voice` o un `audio` de Telegram. */
interface TelegramAudio {
  readonly file_id: string;
  readonly mime_type?: string;
}

/** Devuelve un codigo ISO-639-1 ('es') a partir del language_code de Telegram. */
function toIsoLanguage(languageCode: string | null): string {
  return languageCode !== null && languageCode.length >= 2 ? languageCode.slice(0, 2) : 'es';
}

/**
 * Extension segun el mime type. Groq valida el formato por la EXTENSION del
 * nombre, no por el contenido (comprobado: un WAV renombrado a .oga es
 * rechazado igual). Su allowlist exacta es:
 *
 *   [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]
 *
 * OJO: '.oga' NO esta en la lista aunque sea OGG valido -> usar '.ogg'.
 * Las notas de voz de Telegram son OGG/Opus, o sea 'audio/ogg' -> '.ogg'.
 */
function extensionFor(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('flac')) return 'flac';
  // 'audio/ogg' (notas de voz) y cualquier caso desconocido.
  return 'ogg';
}

async function handleAudio(
  ctx: Context,
  audio: TelegramAudio,
  messageId: number,
): Promise<void> {
  try {
    const user = await resolveUser(ctx);
    if (user === null) {
      await ctx.reply('No pude identificarte 😅 Probá de nuevo.');
      return;
    }

    const mimeType = audio.mime_type ?? 'audio/ogg';
    const fileLink = await ctx.telegram.getFileLink(audio.file_id);
    const download = await fetch(fileLink);
    const bytes = new Uint8Array(await download.arrayBuffer());

    log.debug('Audio descargado', { bytes: bytes.length, mimeType });

    const text = await transcribeAudio({
      audio: bytes,
      filename: `audio.${extensionFor(mimeType)}`,
      mimeType,
      language: toIsoLanguage(user.languageCode),
    });

    if (text === '') {
      await ctx.reply('No te entendí el audio 😅 Probá grabando de nuevo.');
      return;
    }

    // Mismo camino que el texto: gasto, consulta, presupuesto o categoria.
    // Asi se puede preguntar y presupuestar tambien hablando.
    await handleFreeText(ctx, user, text, 'audio', messageId, text);
  } catch (error) {
    // El `detail` trae la respuesta cruda del proveedor: es lo que permite
    // diagnosticar (ej. "invalid file format"). Antes no se logueaba.
    if (error instanceof AiProviderError) {
      log.error('Fallo la transcripcion', {
        status: error.status,
        detail: error.detail,
        error: error.message,
      });
      await ctx.reply('No pude escuchar bien el audio 😔 Probá de nuevo en un momento.');
      return;
    }

    log.error('Fallo el handler de audio', {
      error: error instanceof Error ? error.message : String(error),
    });
    await ctx.reply('Uhh, algo se me rompió con el audio 🙈 Probá de nuevo en un momento.');
  }
}

/** Registra los handlers de notas de voz y de archivos de audio. */
export function registerAudioHandler(bot: Telegraf): void {
  bot.on('voice', (ctx) => handleAudio(ctx, ctx.message.voice, ctx.message.message_id));
  bot.on('audio', (ctx) => handleAudio(ctx, ctx.message.audio, ctx.message.message_id));
}
