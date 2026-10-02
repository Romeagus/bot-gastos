/**
 * Tests del codigo de error visible para el usuario.
 * -----------------------------------------------------------------------------
 * Archivo : tests/diagnostics.test.ts
 *
 * El codigo se le dicta por telefono a alguien que lo tiene que pasar a otro, asi
 * que hay dos propiedades no negociables:
 *   1. ESTABLE: el mismo error siempre da el mismo codigo (asi se busca en el log).
 *   2. LEGIBLE: sin caracteres que se confundan al dictarlos (0/O, 1/I).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorCode } from '../src/services/diagnostics.service.js';

test('el codigo tiene el formato E-XXXX', () => {
  assert.match(errorCode('algo fallo'), /^E-[0-9A-Z]{4}$/);
});

test('el mismo error siempre produce el mismo codigo', () => {
  // Es lo que permite buscar en los logs: si fuera aleatorio, el usuario
  // reportaria un codigo que no corresponde a nada.
  const message = 'Groq devolvio HTTP 429';
  assert.equal(errorCode(message), errorCode(message));
});

test('errores distintos producen codigos distintos', () => {
  assert.notEqual(errorCode('fallo A'), errorCode('fallo B'));
  assert.notEqual(errorCode('fallo A'), errorCode('fallo A2'));
});

test('el codigo no usa caracteres que se confunden al dictarlos', () => {
  // O/0 e I/1 son los errores clasicos al leer un codigo en voz alta.
  const mensajes = Array.from({ length: 60 }, (_, i) => `error numero ${i} distinto`);
  for (const mensaje of mensajes) {
    const code = errorCode(mensaje);
    assert.doesNotMatch(code, /[O0I1]/, `el codigo ${code} tiene caracteres ambiguos`);
  }
});

test('un mensaje largo o vacio no rompe la generacion del codigo', () => {
  assert.match(errorCode(''), /^E-[0-9A-Z]{4}$/);
  assert.match(errorCode('x'.repeat(10_000)), /^E-[0-9A-Z]{4}$/);
});

test('el codigo es estable entre corridas del proceso', () => {
  // FNV-1a es determinista a proposito: no usa Math.random ni la hora.
  assert.equal(errorCode('timeout esperando a la base'), 'E-' + errorCode('timeout esperando a la base').slice(2));
});
