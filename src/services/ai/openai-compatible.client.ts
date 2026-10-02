/**
 * Cliente HTTP para APIs compatibles con OpenAI.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/ai/openai-compatible.client.ts
 *
 * Groq, OpenRouter y DeepSeek exponen el mismo contrato `POST /chat/completions`,
 * asi que un unico cliente cubre a los tres. Se usa `fetch` nativo (Node 18+):
 * no hace falta sumar SDKs de cada proveedor.
 */

import { AiProviderError } from '../../utils/errors.js';

export interface AiContentPartText {
  readonly type: 'text';
  readonly text: string;
}

export interface AiContentPartImage {
  readonly type: 'image_url';
  readonly image_url: { readonly url: string };
}

export type AiContentPart = AiContentPartText | AiContentPartImage;

export interface AiChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly AiContentPart[];
}

export interface ChatCompletionInput {
  /** Nombre del proveedor, solo para los mensajes de error. */
  readonly provider: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly messages: readonly AiChatMessage[];
  readonly temperature?: number;
  /** Fuerza `response_format: json_object` (soportado por DeepSeek/OpenRouter). */
  readonly jsonObject?: boolean;
  readonly timeoutMs?: number;
}

interface ChatCompletionResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: unknown } }>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ejecuta una completion y devuelve el contenido de texto del primer choice.
 *
 * @throws {AiProviderError} ante fallo de red, HTTP no-2xx o respuesta vacia.
 */
export async function chatCompletion(input: ChatCompletionInput): Promise<string> {
  const endpoint = `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const payload: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0,
  };
  if (input.jsonObject === true) {
    payload['response_format'] = { type: 'json_object' };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AiProviderError(`No se pudo contactar a ${input.provider}`, { cause: error });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiProviderError(`${input.provider} respondio HTTP ${response.status}`, {
      status: response.status,
      detail: detail.slice(0, 500),
    });
  }

  const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim() === '') {
    throw new AiProviderError(`${input.provider} devolvio una respuesta sin contenido de texto`);
  }

  return content;
}
