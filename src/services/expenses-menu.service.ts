/**
 * Menus de gestion de gastos (borrar / editar / resetear).
 * -----------------------------------------------------------------------------
 * Archivo : src/services/expenses-menu.service.ts
 *
 * Un unico lugar define estos menus, porque los usan DOS caminos distintos: los
 * comandos (`/borrar`, `/editar`, `/reset`) y el lenguaje natural ("borrá el
 * último"). Antes el menu de borrado vivia en el handler, y eso impedia que el
 * camino conversacional pidiera confirmacion: por eso "borrá el último" por voz
 * borraba sin preguntar.
 *
 * Devuelven `Answer` (texto + botones como datos), sin depender de Telegraf.
 */

import type { Expense } from '../domain/types/expense.js';
import type { User } from '../domain/types/user.js';
import { findById } from '../db/repositories/expenses.repo.js';
import { formatMoney, formatShortDate } from '../utils/format.js';
import { button, plural, truncate, type Answer, type AnswerButton } from './answer.js';
import { categoryLabelMap } from './categories.service.js';
import { getExpenseSummary, listRecentExpenses } from './expenses.service.js';

/** Cuantos gastos se ofrecen en los menus. */
export const MENU_SIZE = 5;

/** Etiqueta que identifica un gasto dentro de un boton. */
function expenseLabel(expense: Expense, labels: Map<string, string>, icon: string): string {
  const name =
    expense.categoryId === null ? 'Sin categoría' : (labels.get(expense.categoryId) ?? '?');
  const amount = formatMoney(expense.amount, expense.currency);
  return `${icon} ${formatShortDate(expense.spentAt)} ${amount} ${truncate(name, 14)}`;
}

/** Encabezado opcional + resumen de la cuenta. */
async function menuHeader(user: User, header?: string): Promise<string> {
  const summary = await getExpenseSummary(user.id);
  const lines: string[] = [];
  if (header !== undefined) {
    lines.push(header, '');
  }
  lines.push(
    `Tenés ${plural(summary.count, 'movimiento', 'movimientos')} por ${formatMoney(summary.total, user.currency)}.`,
  );
  return lines.join('\n');
}

/** Menu para borrar: un boton por gasto, mas "borrar todo". */
export async function buildDeleteMenu(user: User, header?: string): Promise<Answer> {
  const [expenses, labels] = await Promise.all([
    listRecentExpenses(user.id, MENU_SIZE),
    categoryLabelMap(user.id),
  ]);

  if (expenses.length === 0) {
    return {
      text:
        header === undefined
          ? 'No tenés ningún gasto para borrar 🤷'
          : `${header}\n\nNo te queda ningún gasto 🤷`,
    };
  }

  const summary = await getExpenseSummary(user.id);
  const rows: AnswerButton[][] = expenses.map((expense) => [
    button(expenseLabel(expense, labels, '🗑️'), `del:${expense.id}`),
  ]);
  rows.push([button(`🗑️ Borrar TODO (${summary.count})`, 'reset:ask')]);
  rows.push([button('❌ Cerrar', 'mng:close')]);

  const body = await menuHeader(user, header);
  return {
    text: [`🧾 ¿Cuál borro? Tocá el que quieras sacar.`, '', body].join('\n'),
    buttons: rows,
  };
}

/** Menu para editar: un boton por gasto. */
export async function buildEditMenu(user: User, header?: string): Promise<Answer> {
  const [expenses, labels] = await Promise.all([
    listRecentExpenses(user.id, MENU_SIZE),
    categoryLabelMap(user.id),
  ]);

  if (expenses.length === 0) {
    return {
      text:
        header === undefined
          ? 'No tenés ningún gasto para editar 🤷'
          : `${header}\n\nNo tenés ningún gasto 🤷`,
    };
  }

  const rows: AnswerButton[][] = expenses.map((expense) => [
    button(expenseLabel(expense, labels, '✏️'), `edt:${expense.id}`),
  ]);
  rows.push([button('❌ Cerrar', 'mng:close')]);

  const body = await menuHeader(user, header);
  return {
    text: ['✏️ ¿Cuál querés corregir? Tocá el que quieras cambiar.', '', body].join('\n'),
    buttons: rows,
  };
}

/**
 * Menu de campos a editar de un gasto puntual.
 *
 * @returns El menu, o un aviso si el gasto no existe o no es del usuario.
 */
export async function buildEditFieldMenu(
  user: User,
  expenseId: string,
  header?: string,
): Promise<Answer> {
  const expense = await findById(expenseId);

  // Chequeo de dueno: nadie edita gastos ajenos.
  if (expense === null || expense.userId !== user.id) {
    return { text: 'No encontré ese gasto 🤔' };
  }

  const labels = await categoryLabelMap(user.id);
  const what = expenseLabel(expense, labels, '🧾');
  const detail = [expense.merchant, expense.description]
    .filter((value) => value !== null && value !== '')
    .join(' · ');

  const lines: string[] = [];
  if (header !== undefined) {
    lines.push(header, '');
  }
  lines.push(what);
  if (detail !== '') {
    lines.push(`🏪 ${detail}`);
  }
  lines.push('', '¿Qué querés cambiar?');

  return {
    text: lines.join('\n'),
    buttons: [
      [button('💸 El monto', `edtf:${expense.id}:amount`)],
      [button('🏷️ La categoría', `edtf:${expense.id}:category`)],
      [button('❌ Cancelar', 'mng:close')],
    ],
  };
}

/** Confirmacion previa a borrar todo: el usuario elige el alcance. */
export async function buildResetConfirmation(user: User): Promise<Answer> {
  const summary = await getExpenseSummary(user.id);

  if (summary.count === 0) {
    return { text: 'No tenés gastos para borrar 🤷' };
  }

  return {
    text: [
      '⚠️ ¿Seguro que querés borrar todo?',
      '',
      `Se van a borrar ${plural(summary.count, 'movimiento', 'movimientos')} por ${formatMoney(summary.total, user.currency)}.`,
      'Tus categorías propias no se tocan.',
      '',
      'No se puede deshacer desde el chat.',
    ].join('\n'),
    buttons: [
      [button('🗑️ Borrar solo los gastos', 'reset:exp')],
      [button('🗑️ Gastos y topes', 'reset:all')],
      [button('❌ Cancelar', 'reset:no')],
    ],
  };
}