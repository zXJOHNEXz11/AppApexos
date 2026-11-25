import { describe, expect, it } from 'vitest';
import { todayIso } from '../../core/format';
import type { OutboxEntry } from '../../storage/db';
import { mergeMarks } from './marks';

const today = todayIso();
const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const NOW = Date.now();

function entry(type: string, o: Partial<OutboxEntry> & { hour?: number } = {}): OutboxEntry {
  return {
    id: Math.floor(Math.random() * 1e6),
    clientUuid: `uuid-${type}-${Math.random()}`,
    kind: 'marcacion',
    status: 'enviada',
    userId: '7',
    payload: { type, punched_at: at(o.hour ?? 19, 51).toISOString(), metadata: { gps_quality: 'sin_gps' } },
    attempts: 1,
    nextAttemptAt: null,
    createdAt: NOW - 3 * 3600_000,
    sentAt: NOW - 3 * 3600_000,
    ...o,
  } as OutboxEntry;
}

describe('marcaciones de hoy: servidor + cola del celular', () => {
  it('lo que devuelve el servidor se muestra como registrado', () => {
    const marks = mergeMarks([{ type: 'entrada', time: '22:41', date: today }], [], today, NOW);
    expect(marks.get('entrada')).toMatchObject({ synced: true, failed: false });
  });

  it('una enviada que el servidor YA NO tiene (lista fresca posterior) no se muestra', () => {
    const marks = mergeMarks([], [entry('entrada')], today, NOW);
    expect(marks.has('entrada')).toBe(false);
  });

  it('una recién enviada (la lista del servidor es anterior al envío) sí se muestra', () => {
    const marks = mergeMarks([], [entry('entrada', { sentAt: NOW, createdAt: NOW })], today, NOW - 60_000);
    expect(marks.get('entrada')).toMatchObject({ synced: true });
  });

  it('sin señal (lista de la copia local) se confía en lo enviado', () => {
    const marks = mergeMarks([], [entry('entrada')], today, 0);
    expect(marks.get('entrada')).toMatchObject({ synced: true });
  });

  it('pendientes y fallidas siempre se muestran', () => {
    const marks = mergeMarks([], [entry('entrada', { status: 'pendiente' }), entry('salida', { status: 'fallida' })], today, NOW);
    expect(marks.get('entrada')).toMatchObject({ synced: false, failed: false });
    expect(marks.get('salida')).toMatchObject({ synced: false, failed: true });
  });
});
