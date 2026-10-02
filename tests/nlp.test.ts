/**
 * Tests de las utilidades de lenguaje natural (es-AR).
 * -----------------------------------------------------------------------------
 * Archivo : tests/nlp.test.ts
 *
 * Ejecutar: npm test
 *
 * Cubre lo que hace que el bot entienda "como habla la gente": alias de
 * categorias, jerga de montos y la deteccion de pedidos que NO son gastos.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emojiForCategory,
  isBudgetRequest,
  isCategoryRequest,
  isExportRequest,
  parseMoneyPhrase,
  prettifyCategoryName,
  resolveCategorySlug,
  slugifyCategory,
} from '../src/utils/nlp.js';

test('isExportRequest detecta el pedido de exportar a archivo', () => {
  // Sin esto, "pasame el csv de los gastos" llegaba al extractor de gastos y
  // podía terminar anotado como un gasto inventado.
  assert.equal(isExportRequest('exportame los gastos'), true);
  assert.equal(isExportRequest('pasame el csv'), true);
  assert.equal(isExportRequest('bajame un excel'), true);
  assert.equal(isExportRequest('quiero mis gastos en una planilla'), true);
  assert.equal(isExportRequest('descargar los gastos'), true);
  assert.equal(isExportRequest('exportá mis movimientos'), true);
});

test('isExportRequest no confunde un gasto normal', () => {
  assert.equal(isExportRequest('gasté 3500 en el super'), false);
  assert.equal(isExportRequest('cuánto gasté este mes'), false);
  assert.equal(isExportRequest('presupuesto de 50 lucas en super'), false);
});

test('isExportRequest no confunde "pasame/mandame" con otros pedidos', () => {
  // Regresion: al agregar "pasame" y "mandame" al patron, "mandame un resumen" y
  // "pasame el ultimo gasto" daban falso positivo. Son pedidos validos pero NO de
  // exportacion, y se resuelven por el camino conversacional normal.
  assert.equal(isExportRequest('mandame un resumen'), false);
  assert.equal(isExportRequest('pasame el ultimo gasto'), false);
  assert.equal(isExportRequest('pasé 2000 en la nafta'), false);
});

test('resolveCategorySlug traduce los alias es-AR', () => {
  assert.equal(resolveCategorySlug('super'), 'supermercado');
  assert.equal(resolveCategorySlug('nafta'), 'transporte');
  assert.equal(resolveCategorySlug('luz'), 'servicios');
  assert.equal(resolveCategorySlug('peluquería'), 'peluqueria');
  assert.equal(resolveCategorySlug('barberia'), 'peluqueria');
});

test('resolveCategorySlug saca los articulos encadenados ("en el super")', () => {
  // Bug real: antes se sacaba un solo prefijo, asi que quedaba "el super" -> null.
  assert.equal(resolveCategorySlug('en el supermercado'), 'supermercado');
  assert.equal(resolveCategorySlug('en el super'), 'supermercado');
  assert.equal(resolveCategorySlug('del supermercado'), 'supermercado');
  assert.equal(resolveCategorySlug('para la peluqueria'), 'peluqueria');
  assert.equal(resolveCategorySlug('de la luz'), 'servicios');
});

test('resolveCategorySlug traduce los nombres en ingles que devuelven los modelos', () => {
  assert.equal(resolveCategorySlug('groceries'), 'supermercado');
  assert.equal(resolveCategorySlug('Transport'), 'transporte');
  assert.equal(resolveCategorySlug('hairdresser'), 'peluqueria');
  assert.equal(resolveCategorySlug('utilities'), 'servicios');
});

test('resolveCategorySlug devuelve null para lo que no conoce', () => {
  assert.equal(resolveCategorySlug('gimnasio'), null);
  assert.equal(resolveCategorySlug(''), null);
});

test('parseMoneyPhrase entiende la jerga de montos', () => {
  assert.equal(parseMoneyPhrase('50 lucas'), 50000);
  assert.equal(parseMoneyPhrase('50k'), 50000);
  assert.equal(parseMoneyPhrase('1 palo'), 1000000);
  assert.equal(parseMoneyPhrase('50000'), 50000);
  assert.equal(parseMoneyPhrase('50.000'), 50000);
});

test('slugifyCategory cumple el CHECK del DDL (^[a-z0-9_]+$)', () => {
  assert.equal(slugifyCategory('Peluquería y Estética!'), 'peluqueria_y_estetica');
  assert.equal(slugifyCategory('gimnasio'), 'gimnasio');
  assert.equal(slugifyCategory('   '), null);
  assert.match(slugifyCategory('Ñandú 24/7') ?? '', /^[a-z0-9_]+$/);
});

test('isBudgetRequest distingue un tope de un gasto', () => {
  assert.equal(isBudgetRequest('presupuesto de 50 lucas en super'), true);
  assert.equal(isBudgetRequest('presupuesto de 20 lucas en peluqueria'), true);
  assert.equal(isBudgetRequest('poné un tope de 20 lucas en super'), true);
  assert.equal(isBudgetRequest('gasté 3500 en el super'), false);
});

test('isBudgetRequest reconoce las variantes de "limitar"', () => {
  // Bug real: solo matcheaba "limite"/"limitar", no "limita" ni "limitá".
  assert.equal(isBudgetRequest('limita el super a 50000'), true);
  assert.equal(isBudgetRequest('limitá el super a 50000'), true);
  assert.equal(isBudgetRequest('limitame el super a 50000'), true);
  assert.equal(isBudgetRequest('quiero un limite de 50000 en super'), true);
});

test('isCategoryRequest no confunde una consulta con un alta', () => {
  assert.equal(isCategoryRequest('creá la categoría gimnasio'), true);
  assert.equal(isCategoryRequest('agregá una categoría jardín'), true);
  assert.equal(isCategoryRequest('mis categorías'), false);
  assert.equal(isCategoryRequest('qué categorías tengo'), false);
  assert.equal(isCategoryRequest('gasté 500 en el super'), false);
});

test('prettifyCategoryName respeta los conectores en minuscula', () => {
  assert.equal(prettifyCategoryName('peluqueria y estetica'), 'Peluqueria y Estetica');
  assert.equal(prettifyCategoryName('gimnasio'), 'Gimnasio');
});

test('emojiForCategory sugiere un emoji y cae al generico', () => {
  assert.equal(emojiForCategory('gimnasio'), '🏋️');
  assert.equal(emojiForCategory('lo que sea'), '🏷️');
});