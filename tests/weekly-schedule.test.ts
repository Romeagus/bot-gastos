/**
 * Tests del calculo de la semana ISO y de la ventana de envio del resumen semanal.
 * -----------------------------------------------------------------------------
 * Archivo : tests/weekly-schedule.test.ts
 *
 * La logica horaria es la parte mas propensa a bugs silenciosos de este job: si
 * el numero de semana ISO esta mal, la clave de idempotencia cambia y el usuario
 * recibe el resumen DOS veces. Por eso se testean los casos limite (31/12, lunes
 * de la semana 1, años con 53 semanas) contra los valores oficiales de la norma.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDueFor, localNow } from '../src/jobs/weekly-report.job.js';
import { isoWeekNumber, weeklyPeriodKey } from '../src/utils/weekly-schedule.js';

const AR = { timezone: 'America/Argentina/Buenos_Aires' };

test('numero de semana ISO segun la norma ISO-8601', () => {
  // Casos publicados de referencia (ejemplos de la propia norma).
  assert.equal(isoWeekNumber(new Date('2026-01-01T00:00:00Z')), 1);
  assert.equal(isoWeekNumber(new Date('2026-10-02T00:00:00Z')), 40);
  // Año con 53 semanas ISO (2020 empieza en jueves y es bisiesto).
  assert.equal(isoWeekNumber(new Date('2020-12-31T00:00:00Z')), 53);
});

test('la clave semanal cambia de semana y no dentro de la misma', () => {
  // El domingo 2026-10-04 perteneceTodavia a la semana que empezo el lunes
  // 2026-09-28 (las semanas ISO van de lunes a domingo).
  assert.equal(weeklyPeriodKey(new Date('2026-10-04T23:59:00Z')), '2026-W40');
  // El lunes 2026-10-05 arranca una semana nueva.
  assert.equal(weeklyPeriodKey(new Date('2026-10-05T00:00:00Z')), '2026-W41');
  // El lunes siguiente ya es otra semana.
  assert.equal(weeklyPeriodKey(new Date('2026-10-12T00:00:00Z')), '2026-W42');
});

test('la clave semanal tiene siempre el formato AAAA-Www', () => {
  assert.match(weeklyPeriodKey(new Date()), /^\d{4}-W\d{2}$/);
});

test('lee la hora local de Argentina a partir del instante UTC', () => {
  // 13:00 UTC = 10:00 en Argentina (UTC-3, sin horario de verano).
  const local = localNow('America/Argentina/Buenos_Aires', new Date('2026-10-05T13:00:00Z'));
  assert.equal(local.hour, 10);
  assert.equal(local.minute, 0);
  assert.equal(local.weekday, 1); // lunes
});

test('la ventana de envio se dispara el lunes a las 10:00 ARG', () => {
  // 2026-10-05 es lunes; 13:00 UTC = 10:00 ARG.
  assert.equal(isDueFor(AR, new Date('2026-10-05T13:00:00Z')).due, true);
});

test('la ventana de envio tiene cortesia: alcanza con levantarse 10:40 ARG', () => {
  // 13:40 UTC = 10:40 ARG. El proceso pudo estar caido a las 10:00.
  assert.equal(isDueFor(AR, new Date('2026-10-05T13:40:00Z')).due, true);
});

test('no se dispara antes de las 10:00 ARG', () => {
  // 12:59 UTC = 09:59 ARG.
  assert.equal(isDueFor(AR, new Date('2026-10-05T12:59:00Z')).due, false);
});

test('no se dispara mas tarde que 10:59 ARG', () => {
  // 14:30 UTC = 11:30 ARG: ya paso la hora, no se manda a la tarde.
  assert.equal(isDueFor(AR, new Date('2026-10-05T14:30:00Z')).due, false);
});

test('no se dispara en ningun otro dia de la semana', () => {
  // Martes 2026-10-06 a las 10:00 ARG (13:00 UTC).
  assert.equal(isDueFor(AR, new Date('2026-10-06T13:00:00Z')).due, false);
  // Domingo 2026-10-11 a las 10:00 ARG.
  assert.equal(isDueFor(AR, new Date('2026-10-11T13:00:00Z')).due, false);
});

test('respeta la zona horaria del usuario, no la del contenedor', () => {
  const momento = new Date('2026-10-05T13:00:00Z');

  // Mismo instante: 10:00 en Argentina (se manda) pero 07:00 en Mexico (no).
  // Mexico no aplica horario de verano desde 2022, asi que es UTC-6 fijo.
  assert.equal(isDueFor({ timezone: 'America/Argentina/Buenos_Aires' }, momento).due, true);
  assert.equal(isDueFor({ timezone: 'America/Mexico_City' }, momento).due, false);

  // Al reves: 08:00 UTC = 10:00 en Madrid (se manda) y 05:00 en Argentina (no).
  // OJO: en octubre Madrid esta en horario de verano (CEST, UTC+2), no UTC+1.
  const temprano = new Date('2026-10-05T08:00:00Z');
  assert.equal(isDueFor({ timezone: 'Europe/Madrid' }, temprano).due, true);
  assert.equal(isDueFor({ timezone: 'America/Argentina/Buenos_Aires' }, temprano).due, false);
});

test('una zona horaria invalida no rompe el job: cae a Argentina', () => {
  // Sin la proteccion, `Intl` tiraria RangeError y el job entero caeria.
  const momento = new Date('2026-10-05T13:00:00Z');
  assert.equal(isDueFor({ timezone: 'Zona/Inventada' }, momento).due, true);
  assert.equal(isDueFor({ timezone: '' }, momento).due, true);
});

test('la clave de periodo se mantiene igual durante toda la ventana', () => {
  // Aunque se mande a las 10:00 o a las 10:59, es el mismo periodo: asi el
  // segundo envio (por reinicio) se descarta como duplicado.
  const temprano = isDueFor(AR, new Date('2026-10-05T13:00:00Z'));
  const tardio = isDueFor(AR, new Date('2026-10-05T13:59:00Z'));
  assert.equal(temprano.periodKey, tardio.periodKey);
});
