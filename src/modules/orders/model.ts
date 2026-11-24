import { asDate, asDouble, asInt, asMap, asMapList, asString, asStringOrNull, type Json } from '../../core/json';

/** Estados de orden y de solicitud (port de `OrderStatus`). */
export type OrderStatus =
  | 'agendado' | 'pendiente' | 'en_curso' | 'inspeccion' | 'ejecucion'
  | 'bloqueada' | 'cerrada' | 'completada' | 'no_ejecutada' | 'cancelada' | 'desconocido';

const KNOWN: OrderStatus[] = ['agendado', 'pendiente', 'en_curso', 'inspeccion', 'ejecucion', 'bloqueada', 'cerrada', 'completada', 'no_ejecutada', 'cancelada'];

export const parseStatus = (raw: unknown): OrderStatus =>
  KNOWN.includes(raw as OrderStatus) ? (raw as OrderStatus) : 'desconocido';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  agendado: 'Agendado',
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  inspeccion: 'Inspección',
  ejecucion: 'Ejecución',
  bloqueada: 'Bloqueada',
  cerrada: 'Completado',
  completada: 'Completada',
  no_ejecutada: 'No ejecutado',
  cancelada: 'Cancelado',
  desconocido: 'Sin estado',
};

export const isPending = (s: OrderStatus) => s === 'pendiente' || s === 'agendado';
export const isActive = (s: OrderStatus) => s === 'en_curso' || s === 'inspeccion' || s === 'ejecucion';
export const isDone = (s: OrderStatus) => s === 'cerrada' || s === 'completada' || s === 'no_ejecutada' || s === 'cancelada';

/** Paso 0..4 del avance (Inicio, Inspección, Ejecución, Cierre). */
export function stepOf(s: OrderStatus): number {
  if (s === 'agendado' || s === 'pendiente') return 0;
  if (s === 'en_curso') return 1;
  if (s === 'inspeccion') return 2;
  if (s === 'ejecucion') return 3;
  return 4;
}

export interface Piece {
  id: number;
  name: string;
  quantity: number;
  unit: string;
  displayOrder: number;
  description: string | null;
}

export interface RequestItem {
  id: number;
  referenceId: number;
  referenceCode: string;
  referenceName: string;
  serviceType: string;
  quantity: number;
  description: string | null;
  observation: string | null;
  status: OrderStatus;
  pieces: Piece[];
  version: number;
}

export interface ServiceOrder {
  id: number;
  number: string;
  status: OrderStatus;
  serviceType: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string | null;
  invoiceNumber: string | null;
  /** ISO; se guarda como texto para poder cachearlo en IndexedDB. */
  scheduledDate: string | null;
  startedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  noExecutionReason: string | null;
  items: RequestItem[];
  incidentCount: number;
  photoCount: number;
}

const iso = (v: unknown) => asDate(v)?.toISOString() ?? null;

export function itemTitle(i: RequestItem): string {
  return i.referenceCode ? `${i.referenceCode} - ${i.referenceName}` : i.referenceName;
}

export function pieceQuantityLabel(p: Piece): string {
  const whole = Number.isInteger(p.quantity);
  const v = whole ? p.quantity.toFixed(0) : p.quantity.toFixed(2).replace(/0+$/, '').replace('.', ',');
  return `${v} ${p.unit}`;
}

function pieceFromJson(j: Json): Piece {
  return {
    id: asInt(j.id),
    name: asString(j.name),
    quantity: asDouble(j.quantity, 1),
    unit: asString(j.unit, 'und'),
    displayOrder: asInt(j.display_order),
    description: asStringOrNull(j.description),
  };
}

function itemFromJson(j: Json): RequestItem {
  const ref = asMap(j.reference);
  return {
    id: asInt(j.id),
    referenceId: asInt(j.reference_id),
    referenceCode: asString(ref.code),
    referenceName: asString(ref.name),
    serviceType: asString(j.service_type, 'montaje'),
    quantity: asDouble(j.quantity, 1),
    description: asStringOrNull(j.description),
    observation: asStringOrNull(j.observation),
    status: parseStatus(asStringOrNull(j.status)),
    pieces: asMapList(ref.parts).map(pieceFromJson).sort((a, b) => a.displayOrder - b.displayOrder),
    version: asInt(j.version),
  };
}

export function orderFromJson(j: Json): ServiceOrder {
  return {
    id: asInt(j.id),
    number: asString(j.number),
    status: parseStatus(asStringOrNull(j.status)),
    serviceType: asString(j.service_type, 'montaje'),
    customerName: asString(j.customer_name),
    customerAddress: asString(j.customer_address),
    customerPhone: asStringOrNull(j.customer_phone),
    invoiceNumber: asStringOrNull(j.invoice_number),
    scheduledDate: iso(j.scheduled_date),
    startedAt: iso(j.started_at),
    closedAt: iso(j.closed_at),
    notes: asStringOrNull(j.notes),
    noExecutionReason: asStringOrNull(j.no_execution_reason),
    items: asMapList(j.items).map(itemFromJson),
    incidentCount: asMapList(j.incidents).length,
    photoCount: asMapList(j.photos).length,
  };
}

export const completedItems = (o: ServiceOrder) => o.items.filter((i) => isDone(i.status)).length;

/** Siguiente solicitud a trabajar: la primera no terminada ni bloqueada. */
export const nextRequest = (o: ServiceOrder) => o.items.find((i) => !isDone(i.status) && i.status !== 'bloqueada') ?? null;

export type OrderTab = 'pendientes' | 'enCurso' | 'completados';
export const TAB_LABEL: Record<OrderTab, string> = { pendientes: 'Pendientes', enCurso: 'En curso', completados: 'Completados' };
export const inTab = (o: ServiceOrder, t: OrderTab) =>
  t === 'pendientes' ? isPending(o.status) : t === 'enCurso' ? isActive(o.status) : isDone(o.status);

/** Ordena por fecha programada ascendente; sin fecha al final; luego id desc. */
export function sortOrders(a: ServiceOrder, b: ServiceOrder): number {
  if (a.scheduledDate && b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
  if (a.scheduledDate) return -1;
  if (b.scheduledDate) return 1;
  return b.id - a.id;
}

/* -------- Inspección -------- */

export type PieceCondition = 'ok' | 'averiada' | 'faltante';
export type PieceAction = 'ninguna' | 'reponer' | 'reparar' | 'reclamar_proveedor';

export const PIECE_ACTION_LABEL: Record<PieceAction, string> = {
  ninguna: 'Sin acción',
  reponer: 'Reponer',
  reparar: 'Reparar',
  reclamar_proveedor: 'Reclamar al proveedor',
};

/* -------- Encuesta -------- */

export interface SatisfactionQuestion {
  id: string;
  label: string;
  active: boolean;
}

export const questionFromJson = (j: Json): SatisfactionQuestion => ({
  id: asString(j.id),
  label: asString(j.label),
  active: j.active !== false,
});
