/**
 * Arma el texto del resumen semanal.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/weekly-report.service.ts
 *
 * Es un mensaje que el bot MANDA solo, sin que el usuario pregunte: si el texto
 * sale raro o con un numero inventado, el usuario lo ve sin contexto y no puede
 *detectarlo. Por eso aca no participa la IA: los montos y los porcentajes los
 * calcula el codigo con SQL, igual que en el resto del bot.
 *
 * Que muestra:
 *   1. Como viene el mes (total y cuantos movimientos).
 *   2. En que se fue la plata (top 3 categorias).
 *   3. Como vienen los topes (los que estan en zona de alerta, arriba primero).
 *
 * Devuelve `null` si el usuario no tiene nada todavia: es preferible no mandar
 * un mensaje vacio que uno que diga "no gastaste nada" todas las semanas.
 */

import { sumByCategory, summarizePeriod } from '../db/repositories/expenses.repo.js';
import type { User } from '../domain/types/user.js';
import { formatMoney } from '../utils/format.js';
import { plural } from './answer.js';
import { categoryLabelMap } from './categories.service.js';
import { getBudgetStatuses, monthRange, periodOf } from './budgets.service.js';

/** Cuantas categorias muestra el ranking. */
const TOP_N = 3;

/** Nombre del mes en espanol, para el encabezado. */
const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Etiqueta del mes: 'Octubre'. */
function monthLabel(month: number): string {
  const name = MONTH_NAMES[month - 1] ?? '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}


/**
 * Arma el resumen semanal de un usuario.
 *
 * @returns El mensaje, o `null` si todavia no tiene nada anotado.
 */
export async function buildWeeklyReport(user: User, now = new Date()): Promise<string | null> {
  const { from, to } = monthRange(now);
  const { year, month } = periodOf(now);

  const [summary, byCategory, budgets] = await Promise.all([
    summarizePeriod(user.id, from, to),
    sumByCategory(user.id, from, to),
    getBudgetStatuses(user.id, year, month),
  ]);

  // Sin un solo gasto en el mes no hay nada que resumir.
  if (summary.length === 0) {
    return null;
  }

  const labels = await categoryLabelMap(user.id);
  const currency = user.currency;
  const total = summary.reduce((acc, row) => acc + row.total, 0);
  const count = summary.reduce((acc, row) => acc + row.count, 0);

  const lines: string[] = [
    '🌞 Buen día! Así viene tu mes 👇',
    '',
    `💸 ${monthLabel(month)}: ${formatMoney(total, currency)} en ${plural(count, 'movimiento', 'movimientos')}`,
  ];

  // 2) Top de categorias: solo las de la moneda del usuario, para no mezclar.
  const top = byCategory.filter((row) => row.currency === currency).slice(0, TOP_N);

  if (top.length > 0) {
    lines.push('', '🏆 En qué se fue:');
    top.forEach((row, index) => {
      const name = labels.get(row.categoryId ?? '') ?? 'Sin categoría';
      lines.push(`  ${index + 1}. ${name} · ${formatMoney(row.total, currency)}`);
    });
  }

  // 3) Topes: primero los que estan pasados o cerca del limite, que es lo que el
  // usuario necesita mirar primero.
  if (budgets.length > 0) {
    const ORDER = { over: 0, near: 1, ok: 2 } as const;
    const sorted = [...budgets].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
    const alerts = sorted.filter((status) => status.state !== 'ok');

    lines.push('');
    if (alerts.length > 0) {
      lines.push('🎯 Topes:');
      for (const status of alerts) {
        const icon = status.state === 'over' ? '🚨' : '⚠️';
        const name =
          status.category === null
            ? 'Sin categoría'
            : `${status.category.emoji ?? ''} ${status.category.name}`.trim();
        const money = (value: number): string => formatMoney(value, status.budget.currency);

        lines.push(
          status.state === 'over'
            ? // OJO: `remaining` viene con `Math.max(0, ...)`, asi que NUNCA es
              // negativo y `Math.abs(remaining)` siempre daria $0. El excedente
              // real es lo gastado menos el limite.
              `${icon} ${name}: te pasaste por ${money(status.spent - status.budget.limitAmount)} (${status.percent}%)`
            : `${icon} ${name}: vas ${status.percent}%, te quedan ${money(status.remaining)}`,
        );
      }
    } else {
      lines.push('🎯 Todos tus topes van bien 👌');
    }
  }

  lines.push('', 'Mandame un audio o un ticket y lo anoto 😉');

  return lines.join('\n');
}
