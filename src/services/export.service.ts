/**
 * Exportacion de gastos a CSV.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/export.service.ts
 *
 * El dato mas valioso que produce el bot es el historico, y sin esto queda
 * atrapado en una base a la que el usuario no tiene acceso. El CSV lo libera.
 *
 * Decisiones:
 *   * Separador `;` y no `,`: en es-AR la coma es el separador DECIMAL. Con
 *     coma como separador de columnas, Excel/Sheets de config regional argentina
 *     abre el archivo partido en la mitad. El `;` evita ese problema.
 *   * Encabezado con BOM UTF-8: sin el, Excel abre "Peluqueria" sin tilde.
 *   * Fechas dd/mm/aaaa (formato local), no ISO: el archivo lo va a abrir una
 *     persona, no otro programa.
 *   * Se excluyen los gastos `rejected` (borrados logicamente): exportar tambien
 *     lo que el usuario borro daria una contabilidad que no existe.
 */

import type { Expense } from '../domain/types/expense.js';

/** Encabezados del CSV, en orden. */
const HEADERS = [
  'Fecha',
  'Categoría',
  'Comercio',
  'Descripción',
  'Monto',
  'Moneda',
  'Método de pago',
  'Origen',
] as const;

/** Traduce el metodo de pago interno a algo legible. */
const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  debit_card: 'Débito',
  credit_card: 'Crédito',
  transfer: 'Transferencia',
  other: 'Otro',
};

/** Traduce el origen del gasto a algo legible. */
const SOURCE_LABELS: Record<string, string> = {
  text: 'Texto',
  audio: 'Audio',
  photo: 'Foto',
  manual: 'Manual',
};

/** dd/mm/aaaa a partir de una fecha (formato local, no ISO). */
function formatDate(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Escapa un valor para CSV.
 *
 * El caso importante es el punto y coma: si un comercio se llama "Farmacia; SA"
 * sin comillas, Excel lo parte en dos columnas. Se entrecomilla SIEMPRE cuando
 * hay separador, salto de linea o comilla, y se duplican las comillas internas
 * (regla de RFC 4180).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  const needsQuotes = /[";\n\r]/.test(text);
  const escaped = text.replace(/"/g, '""');

  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Une las celdas de una fila. */
function csvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(';');
}

/**
 * Arma el CSV de una lista de gastos.
 *
 * @returns El contenido completo, LISTO para enviar (incluye el BOM).
 */
export function buildCsv(expenses: readonly Expense[], categoryNames: Map<string, string>): string {
  const rows = [csvRow(HEADERS)];

  for (const expense of expenses) {
    rows.push(
      csvRow([
        formatDate(expense.spentAt),
        expense.categoryId === null ? 'Sin categoría' : (categoryNames.get(expense.categoryId) ?? '?'),
        expense.merchant,
        expense.description,
        // El monto va como numero plano (3500.5, no "$3.500"): un CSV es para
        // que otra herramienta lo sume, y el formato es responsabilidad de ella.
        expense.amount,
        expense.currency,
        PAYMENT_LABELS[expense.paymentMethod] ?? expense.paymentMethod,
        SOURCE_LABELS[expense.sourceType] ?? expense.sourceType,
      ]),
    );
  }

  // BOM (byte order mark): sin el, Excel abre el archivo en latin-1 y muestra
  // "PeluquerÃ­a". Se escribe con su escape para que el linter no lo marque como
  // espacio irregular y para que se vea que es intencional.
  const BOM = String.fromCharCode(0xfeff);
  return `${BOM}${rows.join('\r\n')}\r\n`;
}

/** Nombre del archivo, con la fecha de hoy para que sea facil de ubicar. */
export function csvFilename(now = new Date()): string {
  const iso = now.toISOString();
  return `gastos-${iso.slice(0, 10)}.csv`;
}
