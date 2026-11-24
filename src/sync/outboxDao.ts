import { backoffFor, MAX_AUTO_ATTEMPTS } from '../core/backoff';
import { db, type OutboxEntry } from '../storage/db';
import type { OutboxDraft } from './outboxRequests';

/**
 * Acceso a la cola (port de `OutboxDao`). Una sola tabla a propósito: el orden
 * entre foto → inspección → cierre se resuelve por `id` ascendente.
 */
export const outboxDao = {
  /** Si el `clientUuid` ya existe devuelve la que estaba (doble toque). */
  async enqueue(d: OutboxDraft, userId: string): Promise<OutboxEntry> {
    return db.transaction('rw', db.outbox, async () => {
      const existing = await db.outbox.where('clientUuid').equals(d.clientUuid).first();
      if (existing) return existing;
      const entry: OutboxEntry = {
        ...d,
        userId,
        status: 'pendiente',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        createdAt: Date.now(),
      };
      entry.id = await db.outbox.add(entry);
      return entry;
    });
  },

  /** Pendientes cuyo backoff ya venció, en el orden en que se hicieron. */
  async due(userId: string, now: number): Promise<OutboxEntry[]> {
    const rows = await db.outbox.where({ status: 'pendiente', userId }).toArray();
    return rows
      .filter((e) => e.nextAttemptAt === null || e.nextAttemptAt <= now)
      .sort((a, b) => a.id! - b.id!);
  },

  /** Lo que bloquea su cadena: fallidas, enviando, o esperando backoff. */
  async troubled(userId: string, now: number): Promise<OutboxEntry[]> {
    const rows = await db.outbox.where('userId').equals(userId).toArray();
    return rows.filter(
      (e) =>
        e.status === 'fallida' ||
        e.status === 'enviando' ||
        (e.status === 'pendiente' && e.nextAttemptAt !== null && e.nextAttemptAt > now),
    );
  },

  /** Reclamo atómico (transacción IndexedDB): solo uno gana la carrera. */
  async claimForSending(id: number, now: number): Promise<boolean> {
    return db.transaction('rw', db.outbox, async () => {
      const e = await db.outbox.get(id);
      if (!e || e.status !== 'pendiente') return false;
      if (e.nextAttemptAt !== null && e.nextAttemptAt > now) return false;
      await db.outbox.update(id, { status: 'enviando' });
      return true;
    });
  },

  markSent: (id: number) =>
    db.outbox.update(id, { status: 'enviada', lastError: null, nextAttemptAt: null, sentAt: Date.now() }),

  /** Fallo temporal: suma intento; al llegar al tope queda `fallida`. */
  async reschedule(id: number, error: string, now: number): Promise<boolean> {
    const e = await db.outbox.get(id);
    if (!e) return false;
    const attempts = e.attempts + 1;
    const giveUp = attempts >= MAX_AUTO_ATTEMPTS;
    await db.outbox.update(id, {
      status: giveUp ? 'fallida' : 'pendiente',
      attempts,
      lastError: error,
      nextAttemptAt: giveUp ? null : now + backoffFor(attempts),
    });
    return !giveUp;
  },

  /** Vuelve a la cola sin gastar intento (sesión caída). */
  requeue: (id: number) => db.outbox.update(id, { status: 'pendiente' }),

  markFailed: (id: number, error: string) =>
    db.outbox.update(id, { status: 'fallida', lastError: error, nextAttemptAt: null }),

  /**
   * Adelanta el backoff de lo PENDIENTE (no de lo fallido) del usuario. Se usa
   * cuando el técnico pide sincronizar o cuando vuelve la conexión: la espera
   * existía justamente por falta de señal. No borra el conteo de intentos.
   */
  makeDueNow: (userId: string) =>
    db.outbox
      .where({ status: 'pendiente', userId })
      .filter((e) => e.nextAttemptAt !== null)
      .modify({ nextAttemptAt: null }),

  /** Lo que quedó `enviando` al cerrar la pestaña vuelve a pendiente. */
  recoverStuck: () =>
    db.outbox.where('status').equals('enviando').modify({ status: 'pendiente', nextAttemptAt: null }),

  retryFailed: (userId: string) =>
    db.outbox
      .where({ status: 'fallida', userId })
      .modify({ status: 'pendiente', attempts: 0, nextAttemptAt: null, lastError: null }),

  /** Descarta las fallidas y sus archivos. Lo enviado no se toca. */
  async discardFailed(userId: string): Promise<number> {
    return db.transaction('rw', db.outbox, db.files, async () => {
      const rows = await db.outbox.where({ status: 'fallida', userId }).toArray();
      await deleteFilesOf(rows);
      await db.outbox.bulkDelete(rows.map((r) => r.id!));
      return rows.length;
    });
  },

  /**
   * Borra lo confirmado con más de 3 días (y sus archivos). No se borra al
   * confirmar: la UI muestra "subido" un rato, la duda número uno en campo.
   * Un archivo SOLO se elimina cuando el servidor ya confirmó su entrada.
   */
  async purgeSent(keepMs = 3 * 24 * 3600 * 1000): Promise<void> {
    const cutoff = Date.now() - keepMs;
    await db.transaction('rw', db.outbox, db.files, async () => {
      const rows = await db.outbox.where('status').equals('enviada').filter((e) => e.createdAt < cutoff).toArray();
      await deleteFilesOf(rows);
      await db.outbox.bulkDelete(rows.map((r) => r.id!));
    });
  },
};

async function deleteFilesOf(rows: OutboxEntry[]) {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.fileId) ids.add(r.fileId);
    for (const [k, v] of Object.entries(r.fields)) if (k.endsWith('_file') && v) ids.add(v);
  }
  if (ids.size) await db.files.bulkDelete([...ids]);
}

/** Ids de archivos que la entrada necesita para enviarse. */
export function fileIdsOf(e: OutboxEntry): string[] {
  const ids: string[] = [];
  if (e.fileId) ids.push(e.fileId);
  for (const [k, v] of Object.entries(e.fields)) if (k.endsWith('_file') && v) ids.push(v);
  return ids;
}
