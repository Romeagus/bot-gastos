/**
 * Parseo tolerante del JSON que devuelven los modelos de IA.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/json.ts
 *
 * Los modelos envuelven el JSON en ```json ... ``` o agregan texto alrededor.
 * Este helper limpia los envoltorios conocidos y devuelve `null` en lugar de
 * lanzar, para que el llamador decida el valor de respaldo.
 */

export function parseJsonLoose(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}