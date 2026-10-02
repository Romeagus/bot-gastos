/**
 * Tests del contrato de salida de los modelos de IA.
 * -----------------------------------------------------------------------------
 * Archivo : tests/parsed-expense.schema.test.ts
 *
 * Ejecutar: npm test
 *
 * Los modelos NO son confiables: devuelven montos como texto, categorias en
 * ingles, medios de pago inventados o campos faltantes. El esquema tiene que
 * normalizar todo eso sin perder el gasto.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseParsedExpense } from '../src/domain/schemas/parsed-expense.schema.js';

test('normaliza el monto que el modelo devuelve como texto', () => {
  assert.equal(parseParsedExpense({ amount: '19000' })?.amount, 19000);
  assert.equal(parseParsedExpense({ amount: 3500.5 })?.amount, 3500.5);
});

test('devuelve null si falta el monto (el unico campo obligatorio)', () => {
  assert.equal(parseParsedExpense({ category_slug: 'comida' }), null);
  assert.equal(parseParsedExpense({}), null);
  assert.equal(parseParsedExpense(null), null);
});

test('acepta slugs de categorias PROPIAS del usuario', () => {
  const parsed = parseParsedExpense({ amount: 100, category_slug: 'gimnasio' });
  assert.equal(parsed?.category_slug, 'gimnasio');
});

test('normaliza el slug y cae a varios si el formato es invalido', () => {
  assert.equal(
    parseParsedExpense({ amount: 1, category_slug: '  SuperMercado ' })?.category_slug,
    'supermercado',
  );
  assert.equal(
    parseParsedExpense({ amount: 1, category_slug: 'sin categoria!' })?.category_slug,
    'varios',
  );
  assert.equal(parseParsedExpense({ amount: 1 })?.category_slug, 'varios');
});

test('completa con valores por defecto en vez de perder el gasto', () => {
  const parsed = parseParsedExpense({
    amount: 500,
    currency: 'ars',
    payment_method: 'TARJETA',
    confidence: 7,
  });

  assert.equal(parsed?.currency, 'ARS');
  assert.equal(parsed?.payment_method, 'other');
  assert.equal(parsed?.confidence, 0.5);
});

test('descarta fechas no parseables', () => {
  assert.equal(parseParsedExpense({ amount: 1, spent_at: 'ayer' })?.spent_at, null);
  assert.equal(
    parseParsedExpense({ amount: 1, spent_at: '2026-10-02' })?.spent_at,
    '2026-10-02',
  );
});