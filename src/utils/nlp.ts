/**
 * Utilidades de lenguaje natural (es-AR) para interpretar mensajes.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/nlp.ts
 *
 * Hace que el bot "entienda como habla la gente": alias de categorias
 * ("super", "nafta", "luz") y montos con jerga local ("50 lucas", "50k",
 * "1 palo"). Se usa tanto en los comandos como en el interprete del LLM.
 */

import { STANDARD_CATEGORY_SLUGS, type StandardCategorySlug } from '../domain/types/expense.js';
import { parseAmount } from './format.js';

/** Sinonimos frecuentes -> slug estandar. */
const CATEGORY_ALIASES: Record<string, StandardCategorySlug> = {
  // comida
  comida: 'comida',
  almuerzo: 'comida',
  cena: 'comida',
  desayuno: 'comida',
  delivery: 'comida',
  pedidos: 'comida',
  restaurante: 'comida',
  rotiseria: 'comida',
  cafeterias: 'comida',
  cafeteria: 'comida',
  // salidas
  salidas: 'salidas',
  salida: 'salidas',
  boliche: 'salidas',
  bar: 'salidas',
  birra: 'salidas',
  cerveza: 'salidas',
  joda: 'salidas',
  cine: 'salidas',
  recital: 'salidas',
  // supermercado
  supermercado: 'supermercado',
  super: 'supermercado',
  chino: 'supermercado',
  almacen: 'supermercado',
  mercado: 'supermercado',
  verduleria: 'supermercado',
  compras: 'supermercado',
  // transporte
  transporte: 'transporte',
  nafta: 'transporte',
  combustible: 'transporte',
  sube: 'transporte',
  colectivo: 'transporte',
  bondi: 'transporte',
  subte: 'transporte',
  taxi: 'transporte',
  uber: 'transporte',
  remis: 'transporte',
  peaje: 'transporte',
  estacionamiento: 'transporte',
  // servicios
  servicios: 'servicios',
  servicio: 'servicios',
  luz: 'servicios',
  gas: 'servicios',
  agua: 'servicios',
  internet: 'servicios',
  telefono: 'servicios',
  celular: 'servicios',
  alquiler: 'servicios',
  expensas: 'servicios',
  abl: 'servicios',
  monotributo: 'servicios',
  // peluqueria
  peluqueria: 'peluqueria',
  peluquerias: 'peluqueria',
  peluquero: 'peluqueria',
  peluquera: 'peluqueria',
  barberia: 'peluqueria',
  barber: 'peluqueria',
  barbero: 'peluqueria',
  // varios
  varios: 'varios',
  otro: 'varios',
  otros: 'varios',
  misc: 'varios',
};

/**
 * Emoji por defecto para una categoria propia, segun su nombre.
 * Si no hay coincidencia se usa `DEFAULT_CATEGORY_EMOJI`.
 */
const CATEGORY_EMOJIS: Record<string, string> = {
  peluqueria: '💇',
  barberia: '💈',
  unas: '💅',
  estetica: '💅',
  belleza: '💅',
  gimnasio: '🏋️',
  gym: '🏋️',
  deporte: '⚽',
  salud: '🏥',
  farmacia: '💊',
  medico: '🩺',
  obra_social: '🩺',
  educacion: '📚',
  curso: '📚',
  libros: '📚',
  ropa: '👕',
  indumentaria: '👕',
  calzado: '👟',
  hogar: '🏠',
  muebles: '🛋️',
  ferreteria: '🔧',
  herramientas: '🔧',
  jardin: '🌱',
  mascotas: '🐾',
  mascota: '🐾',
  regalos: '🎁',
  viajes: '✈️',
  vacaciones: '✈️',
  tecnologia: '💻',
  electronica: '💻',
  juegos: '🎮',
};

/** Emoji generico cuando no reconocemos la categoria. */
export const DEFAULT_CATEGORY_EMOJI = '🏷️';

/** Quita acentos, pasa a minusculas y colapsa espacios. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isStandardSlug(value: string): value is StandardCategorySlug {
  return (STANDARD_CATEGORY_SLUGS as readonly string[]).includes(value);
}

/**
 * Resuelve un texto libre al slug de categoria estandar.
 * Acepta el slug exacto y alias ("super" -> supermercado, "nafta" -> transporte).
 */
export function resolveCategorySlug(input: string): StandardCategorySlug | null {
  const key = normalize(input);
  if (key === '') {
    return null;
  }
  const bare = key.replace(/^(de|del|en|para|la|el)\s+/, '');
  if (isStandardSlug(bare)) {
    return bare;
  }
  if (isStandardSlug(key)) {
    return key;
  }
  return CATEGORY_ALIASES[bare] ?? CATEGORY_ALIASES[key] ?? null;
}

/**
 * Detecta si el mensaje pide fijar un presupuesto/limite.
 * Necesario para resolver la ambiguedad: "presupuesto de 50 lucas en super"
 * tambien contiene un monto y una categoria, y el extractor de gastos lo
 * confundiria con un gasto.
 */
export function isBudgetRequest(input: string): boolean {
  return /(presupuesto|presupuestar|limite|limitar|tope|budget)/.test(normalize(input));
}

/**
 * Detecta si el mensaje pide CREAR una categoria propia.
 * Ej: "crea una categoria peluqueria", "agrega la categoria gimnasio".
 *
 * Se usa para NO interpretar el pedido como un gasto (menciona un monto o un
 * nombre que el extractor podria confundir).
 */
export function isCategoryRequest(input: string): boolean {
  const text = normalize(input);
  if (!/\bcategorias?\b/.test(text)) {
    return false;
  }
  // "mis categorias", "que categorias tengo" son consultas, no altas.
  if (/\bmis\b|cuales|tengo/.test(text)) {
    return false;
  }
  return /(crea|crear|creo|agrega|agregar|suma|sumar|nueva|nuevo|alta|armar)/.test(text);
}

/**
 * Convierte un nombre libre en un slug valido para `categories.slug`.
 * El DDL exige `^[a-z0-9_]+$`, por eso se quitan acentos y simbolos.
 * "Peluquería y Estética!" -> "peluqueria_y_estetica"
 */
export function slugifyCategory(input: string): string | null {
  const slug = normalize(input)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return slug === '' ? null : slug;
}

/** Conectores que van en minuscula salvo que inicien el nombre. */
const LOWERCASE_WORDS = new Set([
  'y',
  'e',
  'o',
  'u',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'con',
  'para',
  'en',
]);

/** Da formato de titulo: 'peluqueria y estetica' -> 'Peluqueria y Estetica'. */
export function prettifyCategoryName(input: string): string {
  return input
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (word === '') {
        return word;
      }
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_WORDS.has(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Emoji sugerido para una categoria propia, segun su nombre ('gimnasio' -> '🏋️'). */
export function emojiForCategory(name: string): string {
  const key = slugifyCategory(name);
  return key === null ? DEFAULT_CATEGORY_EMOJI : (CATEGORY_EMOJIS[key] ?? DEFAULT_CATEGORY_EMOJI);
}

/** Multiplicadores de la jerga local. */
function slangMultiplier(unit: string): number | null {
  if (/^(mil|k)$/.test(unit)) {
    return 1_000;
  }
  if (/^(luca|lucas)$/.test(unit)) {
    return 1_000;
  }
  if (/^(palo|palos|melon|melones|millon|millones)$/.test(unit)) {
    return 1_000_000;
  }
  return null;
}

/**
 * Interpreta un monto escrito en lenguaje natural.
 * "50000" -> 50000 | "50.000" -> 50000 | "50k" -> 50000
 * "50 lucas" -> 50000 | "1 palo" -> 1000000 | "$ 3.500,50" -> 3500.5
 */
export function parseMoneyPhrase(input: string): number | null {
  const text = normalize(input).replace(/^\$/, '').trim();
  if (text === '') {
    return null;
  }

  const withUnit = /^([\d.,]+)\s*([a-z]+)$/.exec(text);
  if (withUnit !== null) {
    const base = parseAmount(withUnit[1] ?? '');
    const multiplier = slangMultiplier(withUnit[2] ?? '');
    if (base === null || multiplier === null) {
      return null;
    }
    return base * multiplier;
  }

  return parseAmount(text);
}
