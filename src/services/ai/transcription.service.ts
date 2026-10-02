/**
 * Servicio de transcripcion de audio (Groq / Whisper).
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/transcription.service.ts
 *
 * Responsabilidad unica: convertir un audio en texto. No interpreta ni
 * estructura el gasto: eso es trabajo de `reasoning.service.ts`.
 *
 * Se usa `FormData` + `Blob` nativos de Node (18+) para el multipart, sin SDKs.
 */

import { env } from '../../config/env.js';
import { AiProviderError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ai:transcription');

export interface TranscribeAudioInput {
  /** Bytes del audio (ej. `await ctx.telegram.getFileLink()` + fetch, o buffer). */
  readonly audio: Uint8Array;
  /** Nombre con extension; Whisper infiere el formato de aca (ej. 'voz.oga'). */
  readonly filename: string;
  readonly mimeType?: string;
  /** Codigo ISO-639-1 para mejorar la precision (ej. 'es'). */
  readonly language?: string;
  /** Pista de contexto (nombres de comercios, jerga) para mejorar el resultado. */
  readonly prompt?: string;
}

interface TranscriptionResponse {
  readonly text?: unknown;
}

/**
 * Transcribe un audio a texto.
 *
 * @returns El texto transcripto (puede ser vacio si el audio no tiene voz).
 * @throws {AiProviderError} ante fallo de red, HTTP no-2xx o respuesta invalida.
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<string> {
  const endpoint = `${env.GROQ_BASE_URL.replace(/\/+$/, '')}/audio/transcriptions`;

  const form = new FormData();
  form.append('model', env.GROQ_WHISPER_MODEL);
  form.append('response_format', 'json');
  if (input.language !== undefined) {
    form.append('language', input.language);
  }
  if (input.prompt !== undefined) {
    form.append('prompt', input.prompt);
  }
  // Se copia a un Uint8Array nuevo para no exponer el buffer original.
  const bytes = new Uint8Array(input.audio);
  const blob = new Blob([bytes], { type: input.mimeType ?? 'audio/ogg' });
  form.append('file', blob, input.filename);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new AiProviderError('No se pudo contactar a Groq (transcripcion)', { cause: error });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiProviderError(`Groq respondio HTTP ${response.status}`, {
      status: response.status,
      detail: detail.slice(0, 500),
    });
  }

  const data = (await response.json().catch(() => null)) as TranscriptionResponse | null;
  if (typeof data?.text !== 'string') {
    throw new AiProviderError('Groq devolvio una transcripcion invalida');
  }

  const text = data.text.trim();
  log.debug('Transcripcion completada', { characters: text.length });
  return text;
}
