/**
 * Errores de la aplicacion.
 * -----------------------------------------------------------------------------
 * Archivo : src/utils/errors.ts
 *
 * Jerarquia minima para poder clasificar errores y decidir que hacer con ellos
 * (reintentar, avisar al usuario, escalar). `AppError` marca los errores
 * "esperados" de la aplicacion, frente a los inesperados del runtime.
 */

export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    // `new.target` es la clase realmente instanciada: evita repetir `this.name`.
    this.name = new.target.name;
  }
}

/** Error al comunicarse con un proveedor de IA (Groq, OpenRouter, DeepSeek). */
export class AiProviderError extends AppError {
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(
    message: string,
    options: { status?: number; detail?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.detail = options.detail;
  }
}
