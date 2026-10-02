/**
 * Helpers de formato para las respuestas del bot.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/format.ts
 */

/** Formatea un monto con separador de miles y 2 decimales (formato es-AR). */
export function formatAmount(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${formatted}`;
}

/**
 * Interpreta un monto escrito por el usuario en formato local.
 * "50.000" -> 50000 | "50.000,50" -> 50000.5 | "50000" -> 50000
 * Nota: asume que el punto es separador de miles (convencion es-AR).
 */
export function parseAmount(input: string): number | null {
  const normalized = input.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
