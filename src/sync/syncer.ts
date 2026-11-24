import { ApiException } from '../services/apiClient';
import { db, logSync, type OutboxEntry } from '../storage/db';
import { fileIdsOf, outboxDao } from './outboxDao';
import { MissingFileError, type OutboxSender } from './sender';

export interface SyncReport {
  sent: number;
  deferred: number;
  failed: number;
  /** Se cortó por sesión caída: lo que quedó sigue en cola sin gastar intentos. */
  aborted: boolean;
}

const EMPTY: SyncReport = { sent: 0, deferred: 0, failed: 0, aborted: false };
const merge = (a: SyncReport, b: SyncReport): SyncReport => ({
  sent: a.sent + b.sent,
  deferred: a.deferred + b.deferred,
  failed: a.failed + b.failed,
  aborted: a.aborted || b.aborted,
});

/**
 * Cola FIFO de la operación: por orden, o por tipo si no cuelga de orden
 * (marcaciones y actividades no se secuestran entre sí).
 */
const groupOf = (e: OutboxEntry) => (e.orderId !== 0 ? `orden:${e.orderId}` : `tipo:${e.kind}`);

/**
 * Motor de sincronización (port de `OutboxSyncer`).
 *
 * Manda en el orden en que el técnico trabajó y, cuando una operación no sale,
 * DETIENE las siguientes de esa misma solicitud (u orden): una inspección no
 * puede llegar apuntando a una foto que se quedó en el teléfono.
 */
export class OutboxSyncer {
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private static readonly MAX_PASSES = 5;

  private readonly sender: OutboxSender;
  private readonly userId: () => string | null;

  constructor(sender: OutboxSender, userId: () => string | null) {
    this.sender = sender;
    this.userId = userId;
  }

  get isRunning() {
    return this.running !== null;
  }

  /**
   * Llamadas concurrentes comparten la tanda y dejan pedida otra pasada (la
   * pantalla encola en pareja: inspección + paso a ejecución).
   */
  drain(now?: () => number): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.withLock(() => this.passes(now ?? Date.now)).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Entre pestañas: Web Locks evita dos drenajes simultáneos. */
  private async withLock(fn: () => Promise<SyncReport>): Promise<SyncReport> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks) return fn();
    return locks.request('apexos-outbox-drain', { ifAvailable: true }, async (lock) => {
      if (!lock) return EMPTY; // otra pestaña ya está drenando
      return fn();
    });
  }

  private async passes(now: () => number): Promise<SyncReport> {
    let total = EMPTY;
    for (let pass = 0; pass < OutboxSyncer.MAX_PASSES; pass++) {
      this.again = false;
      const report = await this.drainOnce(now());
      total = merge(total, report);
      if (report.aborted || !this.again) break;
    }
    return total;
  }

  private async drainOnce(now: number): Promise<SyncReport> {
    const userId = this.userId();
    if (!userId) return EMPTY;
    const entries = await outboxDao.due(userId, now);
    if (entries.length === 0) return EMPTY;

    // Se siembra con lo que YA estaba con problemas de pasadas anteriores.
    const troubled = await outboxDao.troubled(userId, now);
    const blockedItems = new Set<number>(troubled.filter((e) => e.itemId !== 0).map((e) => e.itemId));
    const troubledGroups = new Set<string>(troubled.map(groupOf));
    // Mejora frente a Flutter: una operación de solicitud (foto, inspección)
    // tampoco se adelanta a una operación de ORDEN anterior con problemas
    // (p. ej. "iniciar servicio" esperando su reintento). Sin esto, si los
    // backoff vencían en otro orden, la inspección podía llegar antes que el
    // inicio y el servidor rechazarla.
    const orderLevelTroubleFrom = new Map<string, number>();
    const markOrderLevel = (e: OutboxEntry) => {
      if (e.itemId !== 0 || e.orderId === 0) return;
      const g = groupOf(e);
      orderLevelTroubleFrom.set(g, Math.min(orderLevelTroubleFrom.get(g) ?? Infinity, e.id!));
    };
    troubled.forEach(markOrderLevel);
    const block = (e: OutboxEntry) => {
      if (e.itemId !== 0) blockedItems.add(e.itemId);
      troubledGroups.add(groupOf(e));
      markOrderLevel(e);
    };

    let sent = 0;
    let deferred = 0;
    let failed = 0;

    for (const entry of entries) {
      const blocked =
        entry.itemId === 0
          ? troubledGroups.has(groupOf(entry))
          : blockedItems.has(entry.itemId) || (orderLevelTroubleFrom.get(groupOf(entry)) ?? Infinity) < entry.id!;
      if (blocked) {
        deferred++;
        continue;
      }

      // El archivo desapareció (el navegador limpió el almacenamiento):
      // reintentarlo ocho veces no lo va a resucitar.
      const fileIds = fileIdsOf(entry);
      if (fileIds.length > 0) {
        const present = await db.files.bulkGet(fileIds);
        if (present.some((f) => !f)) {
          await outboxDao.markFailed(entry.id!, 'La foto ya no está en el teléfono');
          await logSync('error', `${entry.kind}: archivo local perdido`, entry.clientUuid);
          failed++;
          block(entry);
          continue;
        }
      }

      if (!(await outboxDao.claimForSending(entry.id!, now))) {
        deferred++;
        block(entry);
        continue;
      }

      try {
        await this.sender.send(entry);
        await outboxDao.markSent(entry.id!);
        sent++;
      } catch (e) {
        if (e instanceof ApiException) {
          if (e.isAuth) {
            await outboxDao.requeue(entry.id!);
            await logSync('warn', 'Sesión expirada durante la sincronización', entry.clientUuid);
            return { sent, deferred: deferred + 1, failed, aborted: true };
          }
          // La API admite una sola evidencia por ranura: si ya está, el
          // objetivo de la operación se cumple. Se da por enviada.
          if (e.code === 'SERVICE_EVIDENCE_ALREADY_CAPTURED') {
            await outboxDao.markSent(entry.id!);
            sent++;
            continue;
          }
          // `POST /incidents` duplica si se reintenta tras una respuesta
          // perdida: ante un error ambiguo, que decida el técnico.
          const ambiguous = entry.kind === 'novedad' && e.isRetryable;
          if (e.isRetryable && !ambiguous) {
            await outboxDao.reschedule(entry.id!, e.message, now);
            deferred++;
          } else {
            await outboxDao.markFailed(
              entry.id!,
              ambiguous ? `${e.message} — puede que ya se haya guardado, revisa antes de reintentar` : e.message,
            );
            failed++;
          }
          await logSync('error', `${entry.kind} ${entry.method} ${entry.path}: ${e.message}`, entry.clientUuid);
        } else if (e instanceof MissingFileError) {
          await outboxDao.markFailed(entry.id!, e.message);
          failed++;
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          if (entry.kind === 'novedad') {
            await outboxDao.markFailed(entry.id!, `${msg} — puede que ya se haya guardado, revisa antes de reintentar`);
            failed++;
          } else {
            await outboxDao.reschedule(entry.id!, msg, now);
            deferred++;
          }
          await logSync('error', `${entry.kind}: ${msg}`, entry.clientUuid);
        }
        block(entry);
      }
    }
    if (sent > 0) await logSync('info', `Sincronizadas ${sent} operación(es)`);
    return { sent, deferred, failed, aborted: false };
  }
}
