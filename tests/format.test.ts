/**
 * Tests de los helpers de formato.
 * -----------------------------------------------------------------------------
 * Archivo : tests/format.test.ts
 *
 * Ejecutar: npm test
 *
 * El caso de `parseMoneyText` con "19.000" NO es teorico: fue un bug real de la
 * lectura de tickets, donde el modelo devolvia 19 para un total de 19.000 (o sea,
 * mil veces menos). Queda cubierto para que no vuelva a pasar.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatMoney,
  formatShortDate,
  parseAmount,
  parseMoneyText,
} from '../src/utils/format.js';

test('formatMoney usa simbolo de moneda y redondea sin decimales', () => {
  assert.equal(formatMoney(20000, 'ARS'), '$20.000');
  assert.equal(formatMoney(3500.6, 'ARS'), '$3.501');
  assert.equal(formatMoney(1500, 'USD'), 'US$1.500');
  assert.equal(formatMoney(100, 'EUR'), 'EUR 100');
});

test('formatShortDate devuelve dd/mm (no mm/dd)', () => {
  assert.equal(formatShortDate(new Date('2026-10-02T12:00:00Z')), '02/10');
  assert.equal(formatShortDate(new Date('2026-01-31T12:00:00Z')), '31/01');
});

test('parseAmount interpreta el formato es-AR', () => {
  assert.equal(parseAmount('50000'), 50000);
  assert.equal(parseAmount('50.000'), 50000);
  assert.equal(parseAmount('3.500,50'), 3500.5);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseMoneyText NO confunde 19.000 con 19 (bug real de los tickets)', () => {
  assert.equal(parseMoneyText('19.000'), 19000);
  assert.equal(parseMoneyText('$ 19.000'), 19000);
  assert.equal(parseMoneyText('1.234.567,50'), 1234567.5);
  assert.equal(parseMoneyText('19'), 19);
});

test('parseMoneyText detecta el formato ingles inequivoco', () => {
  assert.equal(parseMoneyText('19,000'), 19000);
  assert.equal(parseMoneyText('1,234.56'), 1234.56);
});

test('parseMoneyText devuelve null cuando no hay numeros', () => {
  assert.equal(parseMoneyText(''), null);
  assert.equal(parseMoneyText('TOTAL'), null);
});