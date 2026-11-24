import { describe, expect, it, vi } from 'vitest';
import { MAX_AUTO_ATTEMPTS } from '../core/backoff';
import { ApiException } from '../services/apiClient';
import { db, type OutboxEntry } from '../storage/db';
import { outboxDao } from './outboxDao';
import { OutboxRequests } from './outboxRequests';
import type { OutboxSender } from './sender';
import { OutboxSyncer } from './syncer';

const USER = '7';

class FakeSender implements OutboxSender {
  sent: OutboxEntry[] = [];
  handler: (e: OutboxEntry) => Promise<unknown> = async () => ({});
  async send(e: OutboxEntry) {
    const r = await this.handler(e);
    this.sent.push(e);
    return r;
  }
}

async function file(id: string) {
  await db.files.put({ id, blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), mime: 'image/jpeg', name: `${id}.jpg`, size: 3, userId: USER, createdAt: Date.now() });
}

function photo(orderId: number, itemId: number, fileId: string) {
  return OutboxRequests.photo({ orderId, itemId, type: 'pieza', fileId, fileName: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 3 });
}

const setup = () => {
  const sender = new FakeSender();
  const syncer = new OutboxSyncer(sender, () => USER);
  return { sender, syncer };
};

describe('OutboxSyncer', () => {
  it('envía en el orden en que se registró (foto → inspección → ejecución)', async () => {
    const { sender, syncer } = setup();
    await file('f1');
    await outboxDao.enqueue(photo(1, 10, 'f1'), USER);
    await outboxDao.enqueue(OutboxRequests.inspection({ orderId: 1, itemId: 10, clientUuid: 'insp-1', decision: 'armable', items: [] }), USER);
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    const r = await syncer.drain();
    expect(r).toMatchObject({ sent: 3, failed: 0, deferred: 0 });
    expect(sender.sent.map((e) => e.kind)).toEqual(['evidencia', 'inspeccion', 'ejecucion']);
    expect(await db.outbox.where('status').equals('enviada').count()).toBe(3);
  });

  it('no duplica la operación por doble toque (mismo clientUuid)', async () => {
    const d = OutboxRequests.execution(1, 10);
    await outboxDao.enqueue(d, USER);
    await outboxDao.enqueue(d, USER);
    expect(await db.outbox.count()).toBe(1);
  });

  it('si la foto falla, la inspección de ESA solicitud queda detenida; otra solicitud sigue', async () => {
    const { sender, syncer } = setup();
    await file('f1');
    sender.handler = async (e) => {
      if (e.kind === 'evidencia') throw new ApiException('Error del servidor', 503);
      return {};
    };
    await outboxDao.enqueue(photo(1, 10, 'f1'), USER);
    await outboxDao.enqueue(OutboxRequests.inspection({ orderId: 1, itemId: 10, clientUuid: 'i1', decision: 'armable', items: [] }), USER);
    await outboxDao.enqueue(OutboxRequests.execution(1, 20), USER);
    const r = await syncer.drain();
    expect(r.sent).toBe(1);
    expect(sender.sent.map((e) => e.itemId)).toEqual([20]);
    const photoRow = await db.outbox.where('kind').equals('evidencia').first();
    expect(photoRow).toMatchObject({ status: 'pendiente', attempts: 1, lastError: 'Error del servidor' });
    expect(photoRow!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect((await db.outbox.where('kind').equals('inspeccion').first())!.status).toBe('pendiente');
  });

  it('el cierre de la orden espera a que salgan las solicitudes de esa orden', async () => {
    const { sender, syncer } = setup();
    sender.handler = async (e) => {
      if (e.kind === 'ejecucion') throw new ApiException('timeout');
      return {};
    };
    await outboxDao.enqueue(OutboxRequests.execution(5, 50), USER);
    await outboxDao.enqueue(OutboxRequests.closeOrder({ orderId: 5 }), USER);
    await syncer.drain();
    expect(sender.sent).toHaveLength(0);
    expect((await db.outbox.where('kind').equals('cerrarOrden').first())!.status).toBe('pendiente');
  });

  it('la inspección no se adelanta al "iniciar servicio" de su orden que espera reintento', async () => {
    const { sender, syncer } = setup();
    let startFails = true;
    sender.handler = async (e) => {
      if (e.kind === 'iniciarServicio' && startFails) throw new ApiException('Error del servidor', 503);
      return {};
    };
    await outboxDao.enqueue(OutboxRequests.startOrder(1), USER);
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    await syncer.drain();
    expect(sender.sent).toHaveLength(0);
    // Otra pasada después del backoff del inicio: sale primero el inicio.
    startFails = false;
    await syncer.drain(() => Date.now() + 60_000);
    expect(sender.sent.map((e) => e.kind)).toEqual(['iniciarServicio', 'ejecucion']);
  });

  it('una operación de orden POSTERIOR con problemas no frena solicitudes anteriores', async () => {
    const { sender, syncer } = setup();
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    const close = await outboxDao.enqueue(OutboxRequests.closeOrder({ orderId: 1 }), USER);
    await outboxDao.markFailed(close.id!, 'x');
    await syncer.drain();
    expect(sender.sent.map((e) => e.kind)).toEqual(['ejecucion']);
  });

  it('un 4xx queda fallida con el motivo y no se reintenta solo', async () => {
    const { sender, syncer } = setup();
    sender.handler = async () => { throw new ApiException('Datos inválidos', 422); };
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    const r = await syncer.drain();
    expect(r.failed).toBe(1);
    const row = (await db.outbox.toArray())[0];
    expect(row).toMatchObject({ status: 'fallida', lastError: 'Datos inválidos' });
    await syncer.drain();
    expect(sender.sent).toHaveLength(0);
  });

  it('reintento manual reinicia intentos y vuelve a enviar', async () => {
    const { sender, syncer } = setup();
    let fail = true;
    sender.handler = async () => { if (fail) throw new ApiException('x', 400); return {}; };
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    await syncer.drain();
    fail = false;
    await outboxDao.retryFailed(USER);
    const r = await syncer.drain();
    expect(r.sent).toBe(1);
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: 'enviada', attempts: 0 });
  });

  it('tras el máximo de intentos automáticos queda fallida', async () => {
    const { sender, syncer } = setup();
    sender.handler = async () => { throw new ApiException('sin red'); };
    const e = await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    let t = Date.now();
    for (let i = 0; i < MAX_AUTO_ATTEMPTS; i++) {
      await syncer.drain(() => t);
      t += 2 * 3600 * 1000; // salta el backoff
    }
    expect((await db.outbox.get(e.id!))).toMatchObject({ status: 'fallida', attempts: MAX_AUTO_ATTEMPTS });
  });

  it('un 401 devuelve la operación a la cola sin gastar intento y aborta', async () => {
    const { sender, syncer } = setup();
    sender.handler = async () => { throw new ApiException('Sesión expirada', 401); };
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    await outboxDao.enqueue(OutboxRequests.execution(2, 20), USER);
    const r = await syncer.drain();
    expect(r.aborted).toBe(true);
    const rows = await db.outbox.toArray();
    expect(rows.every((x) => x.status === 'pendiente' && x.attempts === 0)).toBe(true);
  });

  it('una novedad con error ambiguo NO se reintenta sola (evita duplicados)', async () => {
    const { sender, syncer } = setup();
    sender.handler = async () => { throw new ApiException('El servidor tardó demasiado en responder'); };
    await outboxDao.enqueue(OutboxRequests.incident({ orderId: 1, itemId: 10, type: 'no_armable', description: 'x' }), USER);
    await syncer.drain();
    const row = (await db.outbox.toArray())[0];
    expect(row.status).toBe('fallida');
    expect(row.lastError).toContain('puede que ya se haya guardado');
  });

  it('SERVICE_EVIDENCE_ALREADY_CAPTURED se da por enviada', async () => {
    const { sender, syncer } = setup();
    await file('f1');
    sender.handler = async () => { throw new ApiException('ya existe', 409, 'SERVICE_EVIDENCE_ALREADY_CAPTURED'); };
    await outboxDao.enqueue(photo(1, 10, 'f1'), USER);
    const r = await syncer.drain();
    expect(r.sent).toBe(1);
    expect((await db.outbox.toArray())[0].status).toBe('enviada');
  });

  it('si el archivo local desapareció, falla sin llamar a la red', async () => {
    const { sender, syncer } = setup();
    await outboxDao.enqueue(photo(1, 10, 'no-existe'), USER);
    const r = await syncer.drain();
    expect(r.failed).toBe(1);
    expect(sender.sent).toHaveLength(0);
    expect((await db.outbox.toArray())[0].lastError).toBe('La foto ya no está en el teléfono');
  });

  it('marcaciones y actividades van en colas separadas', async () => {
    const { sender, syncer } = setup();
    await file('s1');
    await file('a1');
    sender.handler = async (e) => { if (e.kind === 'marcacion') throw new ApiException('rechazada', 400); return {}; };
    await outboxDao.enqueue(OutboxRequests.attendancePunch({ type: 'entrada', userName: 'T', at: new Date(), gpsQuality: 'sin_gps', clientUuid: 'p1', selfieFileId: 's1' }), USER);
    await outboxDao.enqueue(OutboxRequests.workActivity({ activityTypeId: 1, activityTypeCode: 'c', activityTypeName: 'n', userName: 'T', at: new Date(), fileId: 'a1', gpsQuality: 'sin_gps', observation: '' }), USER);
    const r = await syncer.drain();
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    expect(sender.sent[0].kind).toBe('actividad');
  });

  it('solo envía las operaciones del usuario conectado', async () => {
    const { sender, syncer } = setup();
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), 'otro-usuario');
    const r = await syncer.drain();
    expect(r.sent).toBe(0);
    expect(sender.sent).toHaveLength(0);
    expect((await db.outbox.toArray())[0].status).toBe('pendiente');
  });

  it('llamadas concurrentes comparten la tanda y piden otra pasada', async () => {
    const { sender, syncer } = setup();
    await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    const first = syncer.drain();
    await outboxDao.enqueue(OutboxRequests.execution(2, 20), USER);
    const second = syncer.drain();
    expect(second).toBe(first);
    await first;
    expect(sender.sent).toHaveLength(2);
  });

  it('lo que quedó "enviando" (pestaña cerrada) se recupera', async () => {
    const e = await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    await db.outbox.update(e.id!, { status: 'enviando' });
    await outboxDao.recoverStuck();
    expect((await db.outbox.get(e.id!))!.status).toBe('pendiente');
  });

  it('el reclamo es atómico: dos reclamos sobre la misma fila, solo uno gana', async () => {
    const e = await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    const [a, b] = await Promise.all([outboxDao.claimForSending(e.id!, Date.now()), outboxDao.claimForSending(e.id!, Date.now())]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('la purga borra lo enviado viejo y sus archivos, nunca lo pendiente', async () => {
    await file('old');
    await file('pending');
    const sent = await outboxDao.enqueue(photo(1, 10, 'old'), USER);
    await outboxDao.markSent(sent.id!);
    await db.outbox.update(sent.id!, { createdAt: Date.now() - 5 * 24 * 3600 * 1000 });
    await outboxDao.enqueue(photo(2, 20, 'pending'), USER);
    await outboxDao.purgeSent();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.files.get('old')).toBeUndefined();
    expect(await db.files.get('pending')).toBeDefined();
  });

  it('descartar fallidas no toca lo pendiente', async () => {
    const a = await outboxDao.enqueue(OutboxRequests.execution(1, 10), USER);
    await outboxDao.enqueue(OutboxRequests.execution(2, 20), USER);
    await outboxDao.markFailed(a.id!, 'x');
    expect(await outboxDao.discardFailed(USER)).toBe(1);
    expect((await db.outbox.toArray()).map((x) => x.status)).toEqual(['pendiente']);
  });
});

describe('ApiOutboxSender (payloads reales)', () => {
  it('foto: base64_data como data URL e Idempotency-Key', async () => {
    const { ApiOutboxSender } = await import('./sender');
    await file('f1');
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 201 });
    }));
    const e = await outboxDao.enqueue(photo(3, 30, 'f1'), USER);
    await new ApiOutboxSender().send(e);
    const body = JSON.parse(String(calls[0].init.body));
    expect(calls[0].url).toBe('/api/v1/services/orders/3/photos');
    expect(body.base64_data).toBe('data:image/jpeg;base64,AQID');
    expect(body.metadata.client_upload_id).toBe(e.clientUuid);
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toBe(e.clientUuid);
    vi.unstubAllGlobals();
  });

  it('marcación web: identity_photo y extra_evidence al primer nivel, source ≠ apexos-movil', async () => {
    const { ApiOutboxSender } = await import('./sender');
    await file('s1');
    await file('x1');
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response('{}', { status: 201 });
    }));
    const e = await outboxDao.enqueue(OutboxRequests.attendancePunch({
      type: 'entrada', userName: 'Téc', at: new Date('2026-11-21T13:00:00Z'), gpsQuality: 'gps_confirmado', clientUuid: 'uuid-punch-1',
      fix: { latitude: 4.6, longitude: -74.1, accuracyMeters: 12 }, routeId: 9, vehiclePlate: 'ABC123', startMileageKm: '100.5',
      extraReason: 'congestion_vial', extraDetail: 'trancón', selfieFileId: 's1', extraEvidenceFileId: 'x1',
    }), USER);
    await new ApiOutboxSender().send(e);
    expect(body).toMatchObject({
      type: 'entrada', punched_at: '2026-11-21T13:00:00.000Z', route_id: 9, vehicle_plate: 'ABC123', kilometraje_inicial: '100.5',
      extra_reason: 'congestion_vial', extra_detail: 'trancón', idempotency_key: 'uuid-punch-1', latitude: 4.6,
      identity_photo: { base64: 'data:image/jpeg;base64,AQID', type: 'image/jpeg', size: 3 },
      extra_evidence: { base64: 'data:image/jpeg;base64,AQID' },
    });
    const meta = body.metadata as Record<string, unknown>;
    expect(meta.source).not.toBe('apexos-movil');
    expect(meta.identity).toBeUndefined();
    expect(meta.gps_quality).toBe('gps_confirmado');
    vi.unstubAllGlobals();
  });

  it('estado de solicitud: relee la orden y usa la versión fresca', async () => {
    const { ApiOutboxSender } = await import('./sender');
    const patches: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      if (init.method === 'GET') return new Response(JSON.stringify({ data: { items: [{ id: 30, status: 'ejecucion', version: 7 }] } }), { status: 200 });
      patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 });
    }));
    const e = await outboxDao.enqueue(OutboxRequests.itemStatus(3, 30, 'completada', 2), USER);
    await new ApiOutboxSender().send(e);
    expect(patches).toEqual([{ status: 'completada', expected_version: 7 }]);
    vi.unstubAllGlobals();
  });

  it('estado de solicitud: si ya está en el estado pedido no hace PATCH', async () => {
    const { ApiOutboxSender } = await import('./sender');
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      methods.push(String(init.method));
      return new Response(JSON.stringify({ items: [{ id: 30, status: 'completada', version: 8 }] }), { status: 200 });
    }));
    const e = await outboxDao.enqueue(OutboxRequests.itemStatus(3, 30, 'completada', 2), USER);
    await new ApiOutboxSender().send(e);
    expect(methods).toEqual(['GET']);
    vi.unstubAllGlobals();
  });
});
