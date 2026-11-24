import Dexie, { type EntityTable } from 'dexie';

/** Qué operación del técnico representa la entrada (port de `OutboxKind`). */
export type OutboxKind =
  | 'iniciarServicio'
  | 'evidencia'
  | 'inspeccion'
  | 'ejecucion'
  | 'estadoSolicitud'
  | 'novedad'
  | 'cerrarOrden'
  | 'marcacion'
  | 'actividad'
  | 'desconocida';

export const OUTBOX_KIND_LABEL: Record<OutboxKind, string> = {
  iniciarServicio: 'Inicio del servicio',
  evidencia: 'Foto',
  inspeccion: 'Inspección',
  ejecucion: 'Paso a ejecución',
  estadoSolicitud: 'Estado de la solicitud',
  novedad: 'Novedad',
  cerrarOrden: 'Cierre del servicio',
  marcacion: 'Marcación de jornada',
  actividad: 'Actividad de jornada',
  desconocida: 'Operación',
};

/**
 * - pendiente: esperando turno o que venza el backoff.
 * - enviando: reclamada por un drenaje ahora mismo.
 * - enviada: la API la confirmó (se conserva unos días para mostrar "subido").
 * - fallida: se agotó el reintento automático o la API la rechazó (4xx).
 */
export type OutboxStatus = 'pendiente' | 'enviando' | 'enviada' | 'fallida';

/**
 * Una operación guardada en el teléfono ANTES de tocar la red.
 *
 * Cumple los campos que exige el requerimiento: identificador único
 * (`clientUuid`), fecha y hora (`createdAt`), usuario responsable (`userId`),
 * tipo (`kind`), estado de sincronización (`status`), intentos (`attempts`) y
 * todo lo necesario para reintentar (`method`, `path`, `payload`, `fileId`,
 * `fields`).
 */
export interface OutboxEntry {
  id?: number;
  clientUuid: string;
  kind: OutboxKind;
  method: 'POST' | 'PATCH';
  path: string;
  payload: Record<string, unknown> | null;
  /** Id en la tabla `files` del archivo adjunto (foto/selfie), si lo hay. */
  fileId: string | null;
  /** Campos extra (mime, nombre, ids de archivos secundarios...). */
  fields: Record<string, string>;
  orderId: number;
  itemId: number;
  userId: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  createdAt: number;
  sentAt?: number | null;
}

/** Archivo binario (foto comprimida, selfie, firma) guardado en IndexedDB. */
export interface StoredFile {
  id: string;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  userId: string;
  createdAt: number;
}

/** Caché de lectura (órdenes descargadas, catálogos, reportes...). */
export interface CacheRow {
  key: string;
  userId: string;
  value: unknown;
  updatedAt: number;
}

/** Valores cifrados (token, refresh, usuario) y la llave AES no extraíble. */
export interface SecretRow {
  key: string;
  value: unknown;
}

/**
 * Celular compartido del camión registrado en el maestro (llave WebAuthn).
 * Es del TELÉFONO, no del usuario: no se borra al cerrar sesión.
 */
export interface DeviceRow {
  key: string;
  deviceId: string;
  credentialId: string;
  plate: string;
  label: string | null;
  rpId: string;
  registeredAt: number;
  /** Ingreso con huella: a quién pertenece la llave (para mostrar su botón en el login). */
  userId?: number;
  userName?: string;
  email?: string;
  tenantId?: string;
}

/** Bitácora de sincronización para diagnosticar en campo. */
export interface SyncLogRow {
  id?: number;
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  clientUuid?: string;
}

class ApexosDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, 'id'>;
  files!: EntityTable<StoredFile, 'id'>;
  cache!: EntityTable<CacheRow, 'key'>;
  secrets!: EntityTable<SecretRow, 'key'>;
  syncLog!: EntityTable<SyncLogRow, 'id'>;
  device!: EntityTable<DeviceRow, 'key'>;

  constructor(name = 'apexos-web-movil') {
    super(name);
    this.version(1).stores({
      outbox: '++id, &clientUuid, status, [status+nextAttemptAt], orderId, itemId, userId, kind, createdAt',
      files: 'id, userId, createdAt',
      cache: 'key, userId, updatedAt',
      secrets: 'key',
      syncLog: '++id, at',
    });
    // v2: celular compartido del camión (maestro de celulares de marcación).
    this.version(2).stores({ device: 'key' });
  }
}

export const db = new ApexosDb();
export type { ApexosDb };

/** Pide al navegador que no borre IndexedDB bajo presión de espacio. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* sin soporte: Safari antiguo */
  }
  return false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    /* ignore */
  }
  return null;
}

export async function logSync(level: SyncLogRow['level'], message: string, clientUuid?: string) {
  try {
    await db.syncLog.add({ at: Date.now(), level, message, clientUuid });
    // La bitácora no puede crecer sin límite en el teléfono.
    const count = await db.syncLog.count();
    if (count > 500) {
      const old = await db.syncLog.orderBy('at').limit(count - 500).primaryKeys();
      await db.syncLog.bulkDelete(old);
    }
  } catch {
    /* la bitácora es best-effort */
  }
}
