import { todayIso } from '../../core/format';
import type { OutboxEntry } from '../../storage/db';
import type { PunchType, ServerPunch } from './attendanceApi';

export interface Mark {
  type: PunchType;
  at: Date;
  synced: boolean;
  failed: boolean;
  gpsQuality: string;
}

/**
 * Marcaciones de hoy en pantalla: las del servidor y, encima, las de la cola del celular.
 *
 * Una marcación ya ENVIADA se muestra solo mientras el servidor no la haya devuelto en una
 * lista posterior al envío (recién marcada) o si la lista viene de la copia local (sin señal).
 * Con la lista fresca del servidor, manda el servidor: una enviada que él ya no tiene (por
 * ejemplo, anulada en la base) deja de mostrarse en vez de quedarse "marcada" para siempre.
 *
 * @param serverFreshAt momento (ms) en que llegó la lista del servidor con señal; 0 si viene de la copia local.
 */
export function mergeMarks(serverPunches: ServerPunch[], entries: OutboxEntry[], today: string, serverFreshAt: number): Map<PunchType, Mark> {
  const map = new Map<PunchType, Mark>();
  for (const p of serverPunches) {
    if (p.date && p.date !== today) continue;
    const [h, m] = p.time.split(':').map(Number);
    const at = new Date();
    at.setHours(h || 0, m || 0, 0, 0);
    map.set(p.type, { type: p.type, at, synced: true, failed: false, gpsQuality: '' });
  }
  for (const e of entries) {
    if (e.kind !== 'marcacion' || !e.payload) continue;
    const at = new Date(String(e.payload.punched_at));
    if (todayIso(at) !== today) continue;
    const type = e.payload.type as PunchType;
    const meta = (e.payload.metadata ?? {}) as Record<string, unknown>;
    if (e.status === 'enviada') {
      if (map.has(type)) continue; // el servidor ya la devuelve
      const sentAt = e.sentAt ?? e.createdAt;
      if (serverFreshAt && sentAt < serverFreshAt - 5_000) continue; // el servidor ya no la tiene
    }
    map.set(type, { type, at, synced: e.status === 'enviada', failed: e.status === 'fallida', gpsQuality: String(meta.gps_quality ?? '') });
  }
  return map;
}
