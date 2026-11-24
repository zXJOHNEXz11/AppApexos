import { Api } from '../config/endpoints';
import { newClientUuid } from '../core/ids';
import type { OutboxEntry, OutboxKind } from '../storage/db';

/**
 * Traduce las acciones del técnico a entradas de la cola (port de
 * `OutboxRequests`). Las pantallas no conocen rutas ni payloads.
 */
type Draft = Omit<OutboxEntry, 'id' | 'userId' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'createdAt'>;

function draft(p: Partial<Draft> & Pick<Draft, 'kind' | 'method' | 'path'>): Draft {
  return {
    clientUuid: p.clientUuid ?? newClientUuid(),
    kind: p.kind as OutboxKind,
    method: p.method,
    path: p.path,
    payload: p.payload ?? null,
    fileId: p.fileId ?? null,
    fields: p.fields ?? {},
    orderId: p.orderId ?? 0,
    itemId: p.itemId ?? 0,
  };
}

/** Quita claves con valor null/undefined (equivale a `'k': ?v` de Dart). */
function compact<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export const OutboxRequests = {
  startOrder(orderId: number, fix?: GpsFix | null): Draft {
    return draft({
      kind: 'iniciarServicio',
      method: 'PATCH',
      path: Api.startOrder(orderId),
      payload: compact({
        latitude: fix?.latitude,
        longitude: fix?.longitude,
        accuracy_meters: fix?.accuracyMeters,
      }),
      orderId,
    });
  },

  /** Inspección completa en un solo PATCH (piezas incluidas). */
  inspection(p: {
    orderId: number;
    itemId: number;
    clientUuid: string;
    decision: 'armable' | 'no_armable';
    items: Record<string, unknown>[];
  }): Draft {
    return draft({
      clientUuid: p.clientUuid,
      kind: 'inspeccion',
      method: 'PATCH',
      path: Api.inspection(p.orderId),
      payload: {
        item_id: p.itemId,
        decision: p.decision,
        items: p.items,
        metadata: { client_uuid: p.clientUuid },
      },
      orderId: p.orderId,
      itemId: p.itemId,
    });
  },

  execution(orderId: number, itemId: number): Draft {
    return draft({
      kind: 'ejecucion',
      method: 'PATCH',
      path: Api.execution(orderId),
      payload: { item_id: itemId },
      orderId,
      itemId,
    });
  },

  /** `expected_version` se re-resuelve al enviar (ver sender). */
  itemStatus(orderId: number, itemId: number, status: string, expectedVersion: number): Draft {
    return draft({
      kind: 'estadoSolicitud',
      method: 'PATCH',
      path: Api.itemStatus(orderId, itemId),
      payload: { status, expected_version: expectedVersion },
      orderId,
      itemId,
    });
  },

  /**
   * Evidencia. Se guarda el id del archivo, no el base64: el sender arma el
   * data URL justo antes de mandar. `client_upload_id` hace seguro el reintento.
   */
  photo(p: {
    orderId: number;
    itemId: number;
    type: string;
    fileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    clientUuid?: string;
    metadata?: Record<string, unknown>;
  }): Draft {
    const uuid = p.clientUuid ?? newClientUuid();
    return draft({
      clientUuid: uuid,
      kind: 'evidencia',
      method: 'POST',
      path: Api.photos(p.orderId),
      payload: {
        type: p.type,
        item_id: p.itemId,
        file_name: p.fileName,
        mime_type: p.mimeType,
        size_bytes: p.sizeBytes,
        metadata: { client_upload_id: uuid, ...(p.metadata ?? {}) },
      },
      fileId: p.fileId,
      orderId: p.orderId,
      itemId: p.itemId,
    });
  },

  /** Novedad. `POST /incidents` NO es idempotente en la API (ver syncer). */
  incident(p: { orderId: number; itemId: number; type: string; description: string; clientUuid?: string }): Draft {
    const uuid = p.clientUuid ?? newClientUuid();
    return draft({
      clientUuid: uuid,
      kind: 'novedad',
      method: 'POST',
      path: Api.incidents(p.orderId),
      payload: {
        description: p.description,
        type: p.type,
        item_id: p.itemId,
        action: 'ninguna',
        metadata: { client_uuid: uuid },
      },
      orderId: p.orderId,
      itemId: p.itemId,
    });
  },

  /** Cierre: operación de la orden; espera a que salga todo lo de la orden. */
  closeOrder(p: { orderId: number; fix?: GpsFix | null; metadata?: Record<string, unknown> }): Draft {
    return draft({
      kind: 'cerrarOrden',
      method: 'PATCH',
      path: Api.closeOrder(p.orderId),
      payload: compact({
        latitude: p.fix?.latitude,
        longitude: p.fix?.longitude,
        accuracy_meters: p.fix?.accuracyMeters,
        metadata: p.metadata && Object.keys(p.metadata).length > 0 ? p.metadata : undefined,
      }),
      orderId: p.orderId,
    });
  },

  /**
   * Marcación desde el NAVEGADOR.
   *
   * El backend (`apps/api/src/modules/hr/mobile-identity.js`, `webIdentity`)
   * trata toda marcación cuyo `metadata.source` no sea `apexos-movil` como
   * marcación web: no exige firma del chip (el navegador no tiene), toma la
   * selfie de `identity_photo` AL PRIMER NIVEL y la deja como `photo_only`.
   * Es el mismo contrato que usa la web de APEXOS (`marcacion/page.tsx`).
   */
  attendancePunch(p: {
    type: string;
    userName: string;
    at: Date;
    gpsQuality: string;
    clientUuid: string;
    fix?: GpsFix | null;
    routeId?: number | null;
    vehiclePlate?: string | null;
    startMileageKm?: string | null;
    dayMileageKm?: string | null;
    extraReason?: string | null;
    extraDetail?: string | null;
    selfieFileId?: string | null;
    extraEvidenceFileId?: string | null;
    /** Resultado de la comparación de rostro hecha en el celular (informativo). */
    faceCheck?: Record<string, unknown> | null;
    /** Firma de la huella (WebAuthn) hecha al marcar. */
    webauthn?: Record<string, string> | null;
  }): Draft {
    return draft({
      clientUuid: p.clientUuid,
      kind: 'marcacion',
      method: 'POST',
      path: Api.hrTimePunches,
      payload: compact({
        user_name: p.userName,
        type: p.type,
        punched_at: p.at.toISOString(),
        latitude: p.fix?.latitude,
        longitude: p.fix?.longitude,
        accuracy_meters: p.fix?.accuracyMeters,
        route_id: p.routeId ?? undefined,
        vehicle_plate: p.vehiclePlate || undefined,
        kilometraje_inicial: p.startMileageKm || undefined,
        kilometraje_dia: p.dayMileageKm || undefined,
        extra_reason: p.extraReason || undefined,
        extra_detail: p.extraDetail || undefined,
        idempotency_key: p.clientUuid,
        metadata: {
          source: 'apexos-web-movil',
          channel: 'web',
          current_user_only: true,
          idempotency_key: p.clientUuid,
          gps_quality: p.gpsQuality,
          tracking_mode: p.fix ? 'gps' : 'punch_only',
          biometric_verified: false,
          ...(p.faceCheck ? { face_check: p.faceCheck } : {}),
          ...(p.webauthn ? { webauthn: p.webauthn } : {}),
        },
      }),
      fileId: p.selfieFileId ?? null,
      fields: p.extraEvidenceFileId ? { extra_evidence_file: p.extraEvidenceFileId } : {},
    });
  },

  /** Actividad de jornada (foto obligatoria, sin `route_id`). */
  workActivity(p: {
    activityTypeId: number;
    activityTypeCode: string;
    activityTypeName: string;
    userName: string;
    at: Date;
    fileId: string;
    gpsQuality: string;
    observation: string;
    fix?: GpsFix | null;
  }): Draft {
    const uuid = newClientUuid();
    const located = !!p.fix;
    return draft({
      clientUuid: uuid,
      kind: 'actividad',
      method: 'POST',
      path: Api.hrWorkActivities,
      payload: compact({
        activity_type_id: p.activityTypeId,
        user_name: p.userName,
        occurred_at: p.at.toISOString(),
        observation: p.observation,
        latitude: p.fix?.latitude,
        longitude: p.fix?.longitude,
        accuracy_meters: p.fix?.accuracyMeters,
        gps_required: false,
        gps_skipped: !located,
        idempotency_key: uuid,
        metadata: {
          source: 'apexos-web-movil-actividad',
          gps_required: false,
          gps_skipped: !located,
          gps_quality: p.gpsQuality,
          tracking_mode: located ? 'gps' : 'punch_only',
          activity_type_code: p.activityTypeCode,
          activity_type_name: p.activityTypeName,
        },
      }),
      fileId: p.fileId,
    });
  },
};

export type OutboxDraft = Draft;
