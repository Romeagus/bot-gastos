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
 * Fecha corta dd/mm, para los listados del chat.
 * OJO: es dd/mm (formato argentino), no mm/dd como devolveria un `slice` del ISO.
 */
export function formatShortDate(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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

/**
 * Interpreta un monto IMPRESO (ticket, comprobante, OCR): limpia simbolos de
 * moneda y letras, y desambigua el separador de miles.
 *
 * `parseAmount` asume es-AR (el punto separa miles), pero un ticket podria venir
 * en formato ingles. Se detecta ese caso por su patron inequivoco ("1,234" o
 * "1,234.56") para no equivocarse por un factor de 1000. Por eso existe esta
 * funcion y no se usa `parseAmount` pelado: un "19.000" mal leido como 19 es un
 * error de plata.
 *
 *   "19.000"      -> 19000     (es-AR: miles)
 *   "1.234.567,50"-> 1234567.5 (es-AR)
 *   "$ 19.000"    -> 19000     (se limpia el simbolo)
 *   "1,234.56"    -> 1234.56   (formato ingles inequivoco)
 *   "19,000"      -> 19000     (formato ingles inequivoco)
 */
export function parseMoneyText(value: string): number | null {
  const text = value.replace(/[^\d.,]/g, '').trim();
  if (text === '') {
    return null;
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    return Number(text.replace(/,/g, ''));
  }
  return parseAmount(text);
}
