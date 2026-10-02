/**
 * Respuesta conversacional: texto + botones opcionales.
 * -----------------------------------------------------------------------------
 * Archivo : src/services/answer.ts
 *
 * La capa de servicios NO conoce Telegraf: describe los botones como datos
 * (`text` + `data`) y el handler los convierte en un teclado inline. Asi una
 * respuesta se puede armar (y testear) en un servicio sin framework de por medio.
 */

export interface AnswerButton {
  readonly text: string;
  /** `callback_data` de Telegram: entre 1 y 64 bytes. */
  readonly data: string;
}

export interface Answer {
  readonly text: string;
  /** Filas de botones. Si falta, se responde sin teclado. */
  readonly buttons?: readonly (readonly AnswerButton[])[];
  /**
   * Archivo a enviar en lugar de (o ademas de) un texto.
   *
   * Lo usa la exportacion a CSV: el contenido va como `Buffer` y NO se toca el
   * sistema de archivos, porque el bot corre en un contenedor efimero donde
   * escribir un archivo y volver a leerlo es una carrera sin sentido.
   *
   * OJO: va aparte de `buttons` a proposito. En Telegram un mensaje con teclado
   * inline y un documento a la vez se renderiza raro, asi que el handler elige
   * uno u otro.
   */
  readonly document?: AnswerDocument;
}

/** Archivo listo para enviar por Telegram. */
export interface AnswerDocument {
  /** Nombre con extension (ej. 'gastos-2026-10-02.csv'). */
  readonly filename: string;
  /** Contenido crudo del archivo. */
  readonly content: Buffer;
}

/** Boton de accion (azucar sintactica para no repetir el objeto). */
export function button(text: string, data: string): AnswerButton {
  return { text, data };
}

/** Envuelve un texto suelto como `Answer`. */
export function asAnswer(value: string | Answer): Answer {
  return typeof value === 'string' ? { text: value } : value;
}

/** Pluraliza de forma simple: `plural(1,'movimiento','movimientos')`. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Recorta un texto para que entre comodo en un boton. */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}