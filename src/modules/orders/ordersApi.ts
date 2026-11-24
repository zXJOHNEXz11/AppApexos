import { Api } from '../../config/endpoints';
import { asMap, unwrapData, unwrapList } from '../../core/json';
import { api, canUseCache } from '../../services/apiClient';
import { cacheGet, cachePut } from '../../storage/cache';
import { db } from '../../storage/db';
import { orderFromJson, questionFromJson, type OrderStatus, type SatisfactionQuestion, type ServiceOrder } from './model';

const LIST_KEY = 'orders:list';
const detailKey = (id: number) => `orders:detail:${id}`;
const QUESTIONS_KEY = 'satisfaction-questions';

export interface OrdersResult {
  orders: ServiceOrder[];
  fromCache: boolean;
  updatedAt: number;
}

async function ordersWithPendingOps(): Promise<Set<number>> {
  const open = await db.outbox.where('status').anyOf('pendiente', 'enviando', 'fallida').toArray();
  return new Set(open.map((e) => e.orderId).filter((id) => id !== 0));
}

/**
 * `GET /services/orders?limit=200` con caché offline.
 *
 * Mejora frente a Flutter (que no persistía órdenes): lo descargado queda en
 * IndexedDB para trabajar sin señal. Mientras una orden tiene operaciones en
 * cola, se conserva la copia local (con el avance optimista) en vez de la del
 * servidor, para que la pantalla no "retroceda".
 */
export async function fetchOrders(): Promise<OrdersResult> {
  const cached = await cacheGet<ServiceOrder[]>(LIST_KEY);
  try {
    const res = await api.get(Api.orders, { limit: '200' });
    const fresh = unwrapList(res).map(orderFromJson);
    const pending = await ordersWithPendingOps();
    const local = new Map((cached?.value ?? []).map((o) => [o.id, o]));
    const merged = fresh.map((o) => (pending.has(o.id) && local.has(o.id) ? local.get(o.id)! : o));
    // Las cerradas localmente ya no vienen del servidor (solo devuelve
    // activas); se conservan mientras su cierre siga en la cola.
    for (const o of local.values()) {
      if (pending.has(o.id) && !merged.some((m) => m.id === o.id)) merged.push(o);
    }
    await cachePut(LIST_KEY, merged);
    for (const o of merged) await cachePut(detailKey(o.id), o);
    return { orders: merged, fromCache: false, updatedAt: Date.now() };
  } catch (e) {
    if (canUseCache(e) && cached) return { orders: cached.value, fromCache: true, updatedAt: cached.updatedAt };
    throw e;
  }
}

export async function fetchOrder(id: number): Promise<{ order: ServiceOrder; fromCache: boolean }> {
  const cached = await cacheGet<ServiceOrder>(detailKey(id));
  // Como en Flutter: no se relee el servidor mientras la orden tenga cola.
  if (cached && (await ordersWithPendingOps()).has(id)) return { order: cached.value, fromCache: true };
  try {
    const order = orderFromJson(unwrapData(await api.get(Api.order(id))));
    await saveOrderLocally(order);
    return { order, fromCache: false };
  } catch (e) {
    if (canUseCache(e) && cached) return { order: cached.value, fromCache: true };
    throw e;
  }
}

/** Guarda la orden en el detalle y en la lista cacheada. */
export async function saveOrderLocally(order: ServiceOrder): Promise<void> {
  await cachePut(detailKey(order.id), order);
  const list = await cacheGet<ServiceOrder[]>(LIST_KEY);
  const rows = list?.value ?? [];
  const idx = rows.findIndex((o) => o.id === order.id);
  if (idx >= 0) rows[idx] = order;
  else rows.push(order);
  await cachePut(LIST_KEY, rows);
}

export async function getLocalOrder(id: number): Promise<ServiceOrder | null> {
  return (await cacheGet<ServiceOrder>(detailKey(id)))?.value ?? null;
}

/** Avance optimista local de la orden y/o una solicitud. */
export async function applyLocalStatus(
  orderId: number,
  change: { orderStatus?: OrderStatus; itemId?: number; itemStatus?: OrderStatus; startedAt?: string },
): Promise<ServiceOrder | null> {
  const o = await getLocalOrder(orderId);
  if (!o) return null;
  const next: ServiceOrder = {
    ...o,
    status: change.orderStatus ?? o.status,
    startedAt: o.startedAt ?? change.startedAt ?? null,
    items: o.items.map((i) => (change.itemId === i.id && change.itemStatus ? { ...i, status: change.itemStatus } : i)),
  };
  await saveOrderLocally(next);
  return next;
}

/**
 * Preguntas de la encuesta (configurables por empresa). Se cachean para que un
 * cierre sin cobertura use la última copia validada en este dispositivo.
 */
export async function fetchSatisfactionQuestions(): Promise<SatisfactionQuestion[]> {
  try {
    const res = await api.get(Api.satisfactionQuestions);
    const qs = unwrapList(Array.isArray(res) ? res : asMap(res)).map(questionFromJson).filter((q) => q.active);
    if (qs.length > 0) await cachePut(QUESTIONS_KEY, qs);
    return qs;
  } catch (e) {
    const cached = await cacheGet<SatisfactionQuestion[]>(QUESTIONS_KEY);
    if (cached && cached.value.length > 0) return cached.value;
    throw e;
  }
}
