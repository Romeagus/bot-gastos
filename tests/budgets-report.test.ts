/**
 * Tests del reporte de presupuestos.
 * -----------------------------------------------------------------------------
 * Archivo : tests/budgets-report.test.ts
 *
 * Ejecutar: npm test
 *
 * Se arman los `BudgetStatus` a mano para no depender de la base: lo que se
 * prueba es el TEXTO que ve el usuario (barra, porcentaje, restante), que es
 * justo lo que faltaba cuando el listado solo mostraba el limite.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Budget } from '../src/domain/types/budget.js';
import type { Category } from '../src/domain/types/category.js';
import {
  describeProgress,
  formatBudgetReport,
  type BudgetStatus,
} from '../src/services/budgets.service.js';

const CATEGORY: Category = {
  id: 'c1',
  userId: null,
  slug: 'supermercado',
  name: 'Supermercado',
  emoji: '🛒',
  isSystem: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

/** Arma un estado igual a como lo devuelve `getBudgetStatuses`, sin tocar la base. */
function status(limitAmount: number, spent: number, alertThreshold = 80): BudgetStatus {
  const budget: Budget = {
    id: 'b1',
    userId: 'u1',
    categoryId: CATEGORY.id,
    periodYear: 2026,
    periodMonth: 10,
    limitAmount,
    currency: 'ARS',
    alertThreshold,
    isActive: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };

  const percent = limitAmount <= 0 ? 0 : Math.round((spent / limitAmount) * 100);
  const state: BudgetStatus['state'] =
    spent >= limitAmount ? 'over' : percent >= alertThreshold ? 'near' : 'ok';

  return {
    budget,
    category: CATEGORY,
    spent,
    remaining: Math.max(0, limitAmount - spent),
    percent,
    state,
  };
}

test('describeProgress muestra gastado, porcentaje y restante', () => {
  const text = describeProgress(status(20000, 5000));
  assert.match(text, /llevás \$5\.000 de \$20\.000/);
  assert.match(text, /25%/);
  assert.match(text, /te quedan \$15\.000/);
});

test('describeProgress avisa cuanto se paso del tope', () => {
  const text = describeProgress(status(20000, 23500));
  assert.match(text, /te pasaste por \$3\.500/);
});

test('formatBudgetReport trae barra, porcentaje, total y restante', () => {
  const report = formatBudgetReport([status(20000, 19000)], 'este mes');

  assert.match(report, /🛒 Supermercado/);
  assert.match(report, /95%/);
  assert.match(report, /Total: \$19\.000 de \$20\.000 \(95%\) · te quedan \$1\.000/);
});

test('formatBudgetReport suma varios topes', () => {
  const report = formatBudgetReport([status(20000, 10000), status(30000, 5000)], 'este mes');
  assert.match(report, /Total: \$15\.000 de \$50\.000 \(30%\)/);
});

test('la barra se satura en 10 bloques aunque el porcentaje pase de 100', () => {
  const report = formatBudgetReport([status(1000, 5000)], 'este mes');

  assert.match(report, /▓{10}/);
  assert.doesNotMatch(report, /▓{11}/);
});

test('el excedente se calcula como gastado menos limite, no con el restante', () => {
  // Regresion: el resumen semanal usaba `Math.abs(remaining)`, pero `remaining`
  // viene con `Math.max(0, ...)` y por lo tanto NUNCA es negativo. Eso hacia que
  // al pasarse del tope dijera siempre "te pasaste por $0 (1950%)".
  // El excedente real es `spent - limitAmount`, igual que usa `describeProgress`.
  const pasado = status(1000, 19500);
  assert.equal(pasado.remaining, 0, 'el restante queda Saturado en 0 por diseño');
  assert.equal(pasado.spent - pasado.budget.limitAmount, 18500);
  assert.match(describeProgress(pasado), /te pasaste por \$18\.500/);
});
