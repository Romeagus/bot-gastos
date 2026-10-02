/**
 * Helpers de formato para las respuestas del bot.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/format.ts
 */

/**
 * Formatea un monto para el chat: separador de miles es-AR y SIN decimales.
 * Es a proposito mas coloquial y legible que un `ARS 20.000,00`:
 *   ('ARS', 20000)  -> '$20.000'
 *   ('USD', 1500.5) -> 'US$1.501'
 */
export function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amount);

  if (currency === 'ARS') {
    return `$${formatted}`;
  }
  if (currency === 'USD') {
    return `US$${formatted}`;
  }
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
