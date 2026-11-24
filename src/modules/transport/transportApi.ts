import { Api } from '../../config/endpoints';
import { asBool, asDouble, asInt, asIntOrNull, asMap, asMapList, asString, asStringOrNull, type Json } from '../../core/json';
import { calendarDay } from '../../core/format';
import { api, canUseCache } from '../../services/apiClient';
import { cachedFetch } from '../../storage/cache';

/** Transporte: SOLO LECTURA (`transport:read`), cacheado para ver sin señal. */
const cached = <T,>(key: string, f: () => Promise<T>) => cachedFetch(key, f, canUseCache);
const iso = (v: unknown) => calendarDay(v)?.toISOString() ?? null;

export type Stage = 'aprobado' | 'preliquidado' | 'enProceso' | 'rechazado' | 'anulado';
export const STAGE_LABEL: Record<Stage, string> = { enProceso: 'En proceso', preliquidado: 'Preliquidado', aprobado: 'Aprobado', rechazado: 'Rechazado', anulado: 'Anulado' };
export const STAGE_COLOR: Record<Stage, string> = { aprobado: '#16A34A', preliquidado: '#3B82F6', rechazado: '#EF4444', anulado: '#718A98', enProceso: '#64748B' };

export function stageOf(status: string): Stage {
  if (['aprobada', 'contabilizada', 'liquidada'].includes(status)) return 'aprobado';
  if (['preliquidada', 'con_novedad', 'en_revision'].includes(status)) return 'preliquidado';
  if (status === 'rechazada') return 'rechazado';
  if (['cancelada', 'reversada'].includes(status)) return 'anulado';
  return 'enProceso';
}

const STATUS_LABEL: Record<string, string> = {
  borrador: 'Borrador', validando: 'Validando', preliquidada: 'Preliquidado', con_novedad: 'Con novedad', en_revision: 'En revisión',
  rechazada: 'Rechazado', aprobada: 'Aprobado', contabilizada: 'Contabilizado', liquidada: 'Liquidado', reversada: 'Reversado', cancelada: 'Cancelado',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

export interface Package {
  id: number; code: string; carrierName: string; status: string; calculated: number; adjusted: number; approved: number; accounted: number;
  periodCode: string; start: string | null; end: string | null; blocking: number;
}
export const packageValue = (p: Package) => [p.accounted, p.approved, p.adjusted].find((v) => v !== 0) ?? p.calculated;

const pkg = (m: Json): Package => {
  const per = asMap(m.period);
  return {
    id: asInt(m.id), code: asString(m.code), carrierName: asStringOrNull(m.carrier_name) ?? asStringOrNull(m.carrier_code) ?? 'Sin transportador',
    status: asString(m.status, 'borrador'), calculated: asDouble(m.calculated_total), adjusted: asDouble(m.adjusted_total),
    approved: asDouble(m.approved_total), accounted: asDouble(m.accounted_total), periodCode: asString(per.code),
    start: iso(per.start_date), end: iso(per.end_date), blocking: asInt(m.open_blocking_issues),
  };
};

export const fetchSettlements = (periodId: number | null) =>
  cached(`tr:tower:${periodId ?? 'all'}`, async () =>
    asMapList(asMap(await api.get(Api.settlementTower, { period_id: periodId ? String(periodId) : undefined, limit: '300' })).packages).map(pkg),
  );

export const fetchSettlementPeriods = () =>
  cached('tr:periods', async () => {
    try {
      return asMapList(await api.get(Api.settlementPeriods)).map((m) => ({ id: asInt(m.id), label: asStringOrNull(m.name) ?? asString(m.code) }));
    } catch (e) {
      if (canUseCache(e)) throw e;
      return [];
    }
  });

export interface SettlementItem { guide: string; plate: string | null; route: string | null; date: string | null; amount: number }
export const fetchPackage = (id: number) =>
  cached(`tr:pkg:${id}`, async () => {
    const m = asMap(await api.get(Api.settlementPackage(id)));
    const items = asMapList(m.items).map<SettlementItem>((i) => {
      const origin = asStringOrNull(i.origin_name);
      const dest = asStringOrNull(i.destination_name) ?? asStringOrNull(i.destination_city);
      return {
        guide: asStringOrNull(i.guide_reference) ?? '—',
        plate: asStringOrNull(i.vehicle_plate),
        route: asStringOrNull(i.route_description) ?? (origin || dest ? `${origin ?? '—'} → ${dest ?? '—'}` : null),
        date: iso(i.service_date),
        amount: [asDouble(i.approved_amount), asDouble(i.adjusted_amount)].find((v) => v !== 0) ?? asDouble(i.calculated_amount),
      };
    });
    return { pkg: pkg(m), items };
  });

export interface FleetVehicle { plate: string; site: string | null; status: string; soat: number | null; tecno: number | null }
export const FLEET_STATUS: Record<string, { label: string; color: string }> = {
  bloqueado_documental: { label: 'Bloqueado', color: '#EF4444' },
  pendiente_documentacion: { label: 'Pendiente', color: '#F59E0B' },
  documento_proximo_a_vencer: { label: 'Por vencer', color: '#F97316' },
  apto_documentalmente: { label: 'Al día', color: '#16A34A' },
};
export const fetchFleet = () =>
  cached('tr:fleet', async () => {
    const m = asMap(await api.get(Api.vehicleMetrics));
    return {
      total: asInt(m.total), active: asInt(m.active), blocked: asInt(m.blocked), pending: asInt(m.pending_validation),
      expiring: asInt(m.expiring), avgScore: asInt(m.average_score),
      vehicles: asMapList(m.vehicles).map<FleetVehicle>((v) => ({
        plate: asString(v.plate), site: asStringOrNull(v.base_site), status: asString(v.master_status),
        soat: asIntOrNull(v.soat_days_remaining), tecno: asIntOrNull(v.technical_review_days_remaining),
      })),
    };
  });

export const fetchTransportConfig = () =>
  cached('tr:config', async () => {
    const [cfg, types] = await Promise.all([api.get(Api.pygConfig), api.get(Api.settlementTypes)]);
    return {
      taxPercent: asDouble(asMap(cfg).tax_percent),
      types: asMapList(types).map((t) => ({ code: asString(t.code), name: asStringOrNull(t.name) ?? asString(t.code), active: t.active !== false, reinforced: asBool(t.requires_reinforced_approval) })),
    };
  });
