/**
 * Tests del pre-filtro de instrucciones multiples.
 * -----------------------------------------------------------------------------
 * Archivo : tests/instructions.test.ts
 *
 * Ejecutar: npm test
 *
 * Solo se prueba el pre-filtro determinista (el que decide si vale la pena
 * consultar al modelo): el split en si depende de la IA y se verifica aparte.
 * Importa que NO genere falsos negativos obvios ni gaste llamadas de mas, porque
 * el plan gratuito de Groq tiene 8.000 tokens por minuto.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeMultipleInstructions } from '../src/services/ai/instructions.service.js';

test('detecta mensajes que podrian traer varias instrucciones', () => {
  assert.equal(looksLikeMultipleInstructions('gasté 3500 en el super y 800 de nafta'), true);
  assert.equal(looksLikeMultipleInstructions('anotá 500 en comida, borrá el último'), true);
  assert.equal(looksLikeMultipleInstructions('gasté 3500; pagué la luz'), true);
  assert.equal(looksLikeMultipleInstructions('gasté 3500 y también anotá la luz'), true);
  assert.equal(looksLikeMultipleInstructions('anotá 500 y después borrá el último'), true);
});

test('no molesta al modelo con mensajes de una sola instruccion', () => {
  assert.equal(looksLikeMultipleInstructions('gasté 3500 en el super'), false);
  assert.equal(looksLikeMultipleInstructions('cuánto gasté este mes'), false);
  assert.equal(looksLikeMultipleInstructions('presupuesto de 50 lucas en super'), false);
  assert.equal(looksLikeMultipleInstructions('cargué 20 lucas de nafta'), false);
});