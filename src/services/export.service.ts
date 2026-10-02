/**
 * Exportacion de gastos a CSV.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/export.service.ts
 *
 * El dato mas valioso que produce el bot es el historico, y sin esto queda
 * atrapado en una base a la que el usuario no tiene acceso. El CSV lo libera.
 *
 * Decisiones (verificadas leyendo el archivo generado, no a ojo):
 *   * Separador `;` y no `,`: en es-AR la coma es el separador DECIMAL. Con coma
 *     como separador de columnas, Excel y Google Sheets con configuracion regional
 *     argentina FUSIONAN todas las columnas en una sola. Ese bug sezirio: en un
 *     editor de texto el archivo "parecia" bien (se veian los `;`), pero al abrirlo
 *     todo caia dentro de la primera celda.
 *   * Se entrecomilla SIEMPRE cada celda, no solo cuando hace falta. Con un unico
 *     separador esto no cambia nada, pero vuelve el archivo valido tambien si
 *     alguien lo reimporta pidiendo `,` como separador: los `;` quedan dentro de
 *     comillas y la herramienta los respeta. Asi el archivo sirve igual en un
 *     Excel en ingles y en uno en español.
 *   * BOM UTF-8: sin el, Excel abre "Peluqueria" sin tilde.
 *   * Fechas dd/mm/aaaa (formato local), no ISO: el archivo lo abre una persona.
 *   * Se excluyen los gastos `rejected` (borrados logicamente): exportar tambien
 *     lo que el usuario borro daria una contabilidad que no existe.
 */

import { listAllByUser } from '../db/repositories/expenses.repo.js';
import type { Expense } from '../domain/types/expense.js';
import type { User } from '../domain/types/user.js';
import { plural, type Answer } from './answer.js';
import { categoryNameMap } from './categories.service.js';

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
 * Se entrecomilla SIEMPRE, no solo cuando el valor trae separador. Con un unico
 * separador (`;`) el resultado es el mismo y el archivo sigue siendo valido; pero
 * si alguien lo abre con una herramienta configurada para `,` (un Excel en ingles,
 * o Google Sheets en otro locale), los `;` quedan protegidos dentro de las
 * comillas y las columnas no se fusionan. Es la diferencia entre que el archivo
 * sirva en cualquier maquina o solo en una.
 *
 * Ademas duplica las comillas internas (regla de RFC 4180).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }

  const text = String(value);
  // Siempre entrecomillada; solo se escapan las comillas internas.
  return `"${text.replace(/"/g, '""')}"`;
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

/**
 * Arma la respuesta completa de la exportacion (texto + archivo).
 *
 * Vive en el servicio y no en el handler para que el CSV se pueda pedir igual por
 * `/exportar`, por texto o por audio: los tres caminos terminan aca y devuelven
 * exactamente el mismo archivo.
 *
 * @returns La respuesta, o un texto de aviso si no hay gastos que exportar.
 */
export async function buildExportAnswer(user: User): Promise<Answer> {
  const expenses = await listAllByUser(user.id);

  if (expenses.length === 0) {
    return { text: 'Todavía no tenés gastos para exportar 🤷' };
  }

  const csv = buildCsv(expenses, await categoryNameMap(user.id));

  return {
    text: `📊 Acá tenés tus ${plural(expenses.length, 'gasto', 'gastos')}, listos para abrir en Excel.`,
    document: {
      filename: csvFilename(),
      content: Buffer.from(csv, 'utf8'),
    },
  };
}
