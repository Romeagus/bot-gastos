/**
 * Prueba manual del pipeline de transcripcion (Groq / Whisper).
 * -----------------------------------------------------------------------------
 * Archivo : scripts/test-transcription.ts
 * Uso     : npm run ai:transcribe -- ruta/al/audio.ogg
 *
 * Permite diagnosticar el audio SIN pasar por Telegram: hace exactamente el
 * mismo llamado que en produccion y, si falla, muestra el error crudo del
 * proveedor (que es lo que suele revelar la causa real).
 *
 * IMPORTANTE: Groq valida el formato por la EXTENSION del nombre del archivo
 * (no por el contenido) y su allowlist exacta es:
 *   [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]
 * Por eso '.oga' es rechazado con `unsupported_audio_format` aunque sea un OGG
 * valido. Las notas de voz de Telegram son OGG/Opus -> nombrarlas '.ogg'.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { transcribeAudio } from '../src/services/ai/transcription.service.js';
import { AiProviderError } from '../src/utils/errors.js';

const filePath = process.argv[2];

if (filePath === undefined) {
  console.error('Uso: npm run ai:transcribe -- <archivo-de-audio>');
  process.exit(1);
}

const bytes = await readFile(filePath);
const filename = basename(filePath);
console.log(`  [..]   Transcribiendo ${filename} (${bytes.length} bytes)...`);

try {
  const text = await transcribeAudio({ audio: bytes, filename, language: 'es' });

  if (text === '') {
    console.log('  [aviso] Groq respondio OK pero sin texto (audio en silencio?).');
  } else {
    console.log(`  [ok]   Texto: "${text}"`);
  }
} catch (error) {
  if (error instanceof AiProviderError) {
    console.error(`  [fallo] HTTP ${String(error.status ?? '-')}: ${error.message}`);
    if (error.detail !== undefined) {
      console.error(`  [detalle] ${error.detail}`);
    }
    process.exitCode = 1;
  } else {
    throw error;
  }
}