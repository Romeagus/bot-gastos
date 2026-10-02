/**
 * Tests de la exportacion a CSV.
 * -----------------------------------------------------------------------------
 * Archivo : tests/export.test.ts
 *
 * Lo que se prueba es lo que el usuario ve al abrir el archivo en Excel. Son
 * casos que fallan en silencio: un CSV mal armado no tira error, abre "bien"
 * con los datos partidos en columnas donde no deben.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Expense } from '../src/domain/types/expense.js';
import { buildCsv, csvCell, csvFilename } from '../src/services/export.service.js';

const NAMES = new Map<string, string>([
  ['c1', 'Peluquería'],
  ['c2', 'Supermercado'],
]);

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    userId: 'u1',
    categoryId: 'c1',
    amount: 8000,
    currency: 'ARS',
    merchant: 'Barbería Don Juan',
    description: 'Corte de pelo',
    paymentMethod: 'cash',
    spentAt: new Date('2026-10-02T12:00:00Z'),
    sourceType: 'audio',
    status: 'confirmed',
    rawInput: 'gasté 8000 en la peluquería',
    rawPayload: null,
    aiModel: 'test',
    aiConfidence: 0.98,
    telegramMessageId: 42,
    createdAt: new Date('2026-10-02T12:00:00Z'),
    updatedAt: new Date('2026-10-02T12:00:00Z'),
    ...overrides,
  };
}

/**
 * Parte una fila CSV respetando las comillas (RFC 4180).
 *
 * Hace falta porque `split(';')` partiria tambien los separadores que estan
 * DENTRO de un campo entrecomillado ("Farmacia; SA"), y daria una lectura
 * equivocada de cuantas columnas tiene la fila.
 */
function parseCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i] as string;

    if (inQuotes) {
      if (char === '"') {
        // "" dentro de comillas es un " literal.
        if (row[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ';') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

test('usa punto y coma como separador, no coma', () => {
  // En es-AR la coma es el separador DECIMAL: con coma de columna, Excel con
  // configuracion regional argentina abre el archivo partido al medio.
  const csv = buildCsv([expense()], NAMES);
  const header = csv.replace('﻿', '').split('\r\n')[0] ?? '';
  assert.equal(header, 'Fecha;Categoría;Comercio;Descripción;Monto;Moneda;Método de pago;Origen');
});

test('el archivo arranca con BOM para que Excel respete las tildes', () => {
  const csv = buildCsv([expense()], NAMES);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('escribe la fecha en formato local dd/mm/aaaa', () => {
  const csv = buildCsv([expense()], NAMES);
  assert.match(csv, /02\/10\/2026/);
});

test('trae una fila por gasto con la categoria resuelta', () => {
  const csv = buildCsv([expense()], NAMES);
  assert.match(csv, /Peluquería/);
  assert.match(csv, /8000;ARS/);
});

test('el monto va como numero plano, no como texto con signo', () => {
  // Un CSV es para que otra herramienta lo sume: "$8.000" no se puede sumar.
  const csv = buildCsv([expense()], NAMES);
  const row = csv.split('\r\n')[1] ?? '';
  assert.ok(row.includes(';8000;ARS;'), 'el monto debe ser 8000 pelado');
  assert.doesNotMatch(row, /\$8/);
});

test('traduce el metodo de pago y el origen a algo legible', () => {
  const csv = buildCsv([expense()], NAMES);
  assert.match(csv, /Efectivo/);
  assert.match(csv, /Audio/);
});

test('escapa las comillas dobles duplicandolas', () => {
  // Regla de RFC 4180: un " dentro de un campo entrecomillado se escribe "".
  assert.equal(csvCell('dijo "hola"'), '"dijo ""hola"""');
});

test('entrecomilla cuando el valor tiene el separador o un salto de linea', () => {
  assert.equal(csvCell('Farmacia; SA'), '"Farmacia; SA"');
  assert.equal(csvCell('linea 1\nlinea 2'), '"linea 1\nlinea 2"');
});

test('un comercio con punto y coma no parte el archivo en dos columnas', () => {
  const csv = buildCsv([expense({ merchant: 'Farmacia; SA' })], NAMES);
  const row = csv.split('\r\n')[1] ?? '';

  // OJO: NO se cuenta con `split(';')`, porque partiria tambien el punto y coma
  // DENTRO de las comillas y daria un falso positivo. Se parsea con comillas.
  assert.deepEqual(parseCsvRow(row), [
    '02/10/2026',
    'Peluquería',
    'Farmacia; SA',
    'Corte de pelo',
    '8000',
    'ARS',
    'Efectivo',
    'Audio',
  ]);
});

test('un gasto sin categoria no rompe la fila', () => {
  const csv = buildCsv([expense({ categoryId: null })], NAMES);
  assert.match(csv, /Sin categoría/);
});

test('valores vacios quedan como celdas vacias, no como "null"', () => {
  const csv = buildCsv([expense({ merchant: null, description: null })], NAMES);
  assert.doesNotMatch(csv, /null/);
});

test('con varios gastos hay una fila por cada uno, mas el encabezado', () => {
  const csv = buildCsv(
    [expense(), expense({ id: 'e2', categoryId: 'c2' }), expense({ id: 'e3' })],
    NAMES,
  );
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lines.length, 4);
});

test('el nombre del archivo incluye la fecha de hoy', () => {
  assert.equal(csvFilename(new Date('2026-10-02T10:00:00Z')), 'gastos-2026-10-02.csv');
});
