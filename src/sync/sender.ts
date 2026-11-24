import { Api } from '../config/endpoints';
import { asInt, asMapList, asString, unwrapData, type Json } from '../core/json';
import { api, ApiException } from '../services/apiClient';
import { db, type OutboxEntry, type StoredFile } from '../storage/db';

/** Lo único que la cola necesita de la red. Se sustituye en las pruebas. */
export interface OutboxSender {
  send(entry: OutboxEntry): Promise<unknown>;
}

/** Error propio de la cola cuando falta un archivo local. */
export class MissingFileError extends Error {}

/** Blob → base64 sin FileReader (sirve igual en navegador y en pruebas). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Data URL (`data:image/jpeg;base64,...`): la forma que pintan las pantallas
 * web de APEXOS con `src={base64_data}`. Sin prefijo se veía imagen rota.
 */
export async function dataUrl(file: StoredFile): Promise<string> {
  const mime = file.mime?.trim() || 'image/jpeg';
  return `data:${mime};base64,${await blobToBase64(file.blob)}`;
}

async function loadFile(id: string): Promise<StoredFile> {
  const f = await db.files.get(id);
  if (!f) throw new MissingFileError('La foto ya no está en el teléfono');
  return f;
}

async function photoObject(file: StoredFile, fallbackName: string) {
  return { base64: await dataUrl(file), name: file.name || fallbackName, type: file.mime, size: file.size };
}

/**
 * La API responde 2xx con `{ok:false}` cuando NO registró la operación; el caso
 * conocido: conductor con placa sin checklist preoperacional aprobado
 * (`preoperational_required`). Sin esto la cola la daría por enviada y la marcación
 * se perdería en silencio. Se trata como rechazo definitivo (lo ve el técnico).
 */
export function assertAccepted(res: unknown): unknown {
  const m = res && typeof res === 'object' ? (res as Record<string, unknown>) : null;
  if (m && m.ok === false) {
    const preop = m.preoperational_required === true;
    throw new ApiException(
      String(m.message || (preop ? 'Checklist preoperacional obligatorio antes de iniciar jornada.' : 'El servidor no registró la operación.')),
      422,
      preop ? 'PREOPERACIONAL_REQUERIDO' : 'OPERACION_NO_REGISTRADA',
    );
  }
  return res;
}

/** Implementación real sobre el cliente de la API (port de `ApiOutboxSender`). */
export class ApiOutboxSender implements OutboxSender {
  private orderCache = new Map<number, { at: number; response: Json }>();
  private static readonly ORDER_CACHE_TTL = 5_000;

  send(entry: OutboxEntry): Promise<unknown> {
    switch (entry.kind) {
      case 'actividad':
        return this.sendWorkActivity(entry);
      case 'marcacion':
        return this.sendPunch(entry);
      case 'estadoSolicitud':
        return this.sendItemStatus(entry);
      default:
        if (entry.fileId) return this.sendPhoto(entry);
        return this.sendJson(entry, entry.payload ?? {});
    }
  }

  private async sendJson(entry: OutboxEntry, body: unknown) {
    const res =
      entry.method === 'PATCH'
        ? await api.patch(entry.path, body, { idempotencyKey: entry.clientUuid })
        : await api.post(entry.path, body, { idempotencyKey: entry.clientUuid });
    return assertAccepted(res);
  }

  /** `POST /photos` con `base64_data` (data URL) dentro del JSON. */
  private async sendPhoto(entry: OutboxEntry) {
    const file = await loadFile(entry.fileId!);
    return this.sendJson(entry, {
      ...(entry.payload ?? {}),
      base64_data: await dataUrl(file),
      size_bytes: file.size,
    });
  }

  /**
   * Marcación web: selfie en `identity_photo` y sustento en `extra_evidence`,
   * ambos al primer nivel (contrato de `webIdentity` / `normalizeExtraEvidence`).
   */
  private async sendPunch(entry: OutboxEntry) {
    const payload: Json = { ...(entry.payload ?? {}) };
    if (entry.fileId) payload.identity_photo = await photoObject(await loadFile(entry.fileId), 'selfie.jpg');
    const extra = entry.fields.extra_evidence_file;
    if (extra) payload.extra_evidence = await photoObject(await loadFile(extra), 'sustento.jpg');
    return this.sendJson(entry, payload);
  }

  /** `photo` anidada con sus cuatro campos (`workActivitySchema`). */
  private async sendWorkActivity(entry: OutboxEntry) {
    const file = await loadFile(entry.fileId!);
    return this.sendJson(entry, { ...(entry.payload ?? {}), photo: await photoObject(file, 'actividad.jpg') });
  }

  /**
   * Concurrencia optimista vs. cola offline: la versión de cuando el técnico
   * tocó el botón ya está vencida. Se relee la orden y:
   * - si la solicitud ya está en el estado pedido → nada que hacer;
   * - si sigue donde estaba → se manda con la versión fresca;
   * - si no existe → 404 para que un humano lo mire.
   */
  private async sendItemStatus(entry: OutboxEntry) {
    const target = asString(entry.payload?.status);
    const response = await this.fetchOrder(entry.orderId);
    const order = unwrapData(response);
    const item = asMapList(order.items).find((c) => asInt(c.id) === entry.itemId);
    if (!item) throw new ApiException('La solicitud ya no existe en la orden', 404);
    if (asString(item.status) === target) return response;

    const result = await api.patch(
      entry.path,
      { status: target, expected_version: asInt(item.version) },
      { idempotencyKey: entry.clientUuid },
    );
    const resultOrder = unwrapData(result);
    if (resultOrder.items !== undefined) {
      this.orderCache.set(entry.orderId, { at: Date.now(), response: result as Json });
    } else {
      this.orderCache.delete(entry.orderId);
    }
    return result;
  }

  private async fetchOrder(orderId: number): Promise<Json> {
    const cached = this.orderCache.get(orderId);
    if (cached && Date.now() - cached.at < ApiOutboxSender.ORDER_CACHE_TTL) return cached.response;
    const response = (await api.get(Api.order(orderId))) as Json;
    this.orderCache.set(orderId, { at: Date.now(), response });
    return response;
  }
}
