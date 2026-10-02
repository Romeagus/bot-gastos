/**
 * Ediciones pendientes: el usuario toco "cambiar el monto" y el bot espera el valor.
 * -----------------------------------------------------------------------------
 * Archivo : src/bot/pending-edit.ts
 *
 * El estado es EN MEMORIA y a proposito minimo: solo que gasto y que campo se
 * esta editando, con vencimiento. Mantener una tabla nueva en la base para un
 * flujo de dos pasos seria desproporcionado. Si el proceso se reinicia (Railway
 * redeploya seguido) la edicion se pierde y el usuario vuelve a tocar /editar:
 * preferible eso a dejar estado inconsistente en la base.
 */

export type EditableField = 'amount' | 'category';

export interface PendingEdit {
  readonly expenseId: string;
  readonly field: EditableField;
}

interface StoredEdit extends PendingEdit {
  readonly expiresAt: number;
}

/** Cuanto vale una edicion pendiente antes de descartarse. */
const TTL_MS = 5 * 60 * 1000;

const pending = new Map<string, StoredEdit>();

/** Marca que el usuario esta por editar ese campo de ese gasto. */
export function setPendingEdit(userId: string, expenseId: string, field: EditableField): void {
  pending.set(userId, { expenseId, field, expiresAt: Date.now() + TTL_MS });
}

/**
 * Devuelve y CONSUME la edicion pendiente del usuario.
 * Si vencio, se descarta y devuelve `null`.
 */
export function takePendingEdit(userId: string): PendingEdit | null {
  const edit = pending.get(userId);
  if (edit === undefined) {
    return null;
  }

  pending.delete(userId);

  if (edit.expiresAt < Date.now()) {
    return null;
  }
  return { expenseId: edit.expenseId, field: edit.field };
}

/** Descarta la edicion pendiente (el usuario pidio otra cosa). */
export function clearPendingEdit(userId: string): void {
  pending.delete(userId);
}