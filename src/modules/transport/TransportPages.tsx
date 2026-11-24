import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../../app/TopBar';
import { Icon } from '../../components/Icon';
import { KpiGrid, KpiTile, ReadOnlyNote, SelectField } from '../../components/report';
import { CenterSpinner, EmptyState, InfoBox, ModuleCard, Panel, Pill, ScreenHeader } from '../../components/ui';
import { formatCop, formatPct, shortDate } from '../../core/format';
import {
  fetchFleet, fetchPackage, fetchSettlementPeriods, fetchSettlements, fetchTransportConfig, FLEET_STATUS, packageValue,
  STAGE_COLOR, STAGE_LABEL, stageOf, statusLabel, type Stage,
} from './transportApi';

const d = (s: string | null) => (s ? new Date(s) : null);
const CacheNote = ({ on }: { on?: boolean }) => (on ? <InfoBox tone="warn" icon="cloudOff">Sin conexión: datos guardados en el teléfono.</InfoBox> : null);

/** Inicio del módulo (port de `transport_home_screen.dart`). */
export function TransportHomePage() {
  const navigate = useNavigate();
  return (
    <div className="pb-nav">
      <TopBar title="Transporte" />
      <div className="space-y-3 px-3">
        <Panel>
          <p className="text-lg font-bold">Módulo de Transporte</p>
          <p className="text-[13px] text-muted">Rentabilidad de la flota, liquidaciones y costos de la operación.</p>
        </Panel>
        <ModuleCard icon="truck" gradient="blue" title="Transporte" subtitle="Información general, vehículos y operaciones." onClick={() => navigate('/transporte/flota')} />
        <ModuleCard icon="receipt" gradient="teal" title="Liquidaciones" subtitle="Torre de liquidaciones y costos por transportador." onClick={() => navigate('/transporte/liquidaciones')} />
        <ModuleCard icon="settings" gradient="violet" title="Configuración" subtitle="Parámetros del módulo (solo consulta)." onClick={() => navigate('/transporte/configuracion')} />
      </div>
    </div>
  );
}

const days = (label: string, v: number | null) => `${label}: ${v === null ? '—' : v < 0 ? 'vencido' : `${v} días`}`;

export function FleetPage() {
  const q = useQuery({ queryKey: ['tr', 'fleet'], queryFn: fetchFleet });
  const f = q.data?.value;
  return (
    <div className="pb-10">
      <ScreenHeader title="Flota" />
      <div className="space-y-3 p-3">
        {q.isLoading ? <CenterSpinner /> : q.error || !f ? (
          <EmptyState icon="alert" title="No se pudo cargar la flota" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <CacheNote on={q.data?.fromCache} />
            <KpiGrid>
              <KpiTile label="Vehículos" value={String(f.total)} icon="truck" />
              <KpiTile label="Activos" value={String(f.active)} icon="checkCircle" color="#16A34A" />
              <KpiTile label="Puntaje promedio" value={String(f.avgScore)} icon="chart" color="#8B5CF6" />
              <KpiTile label="Bloqueados" value={String(f.blocked)} icon="alert" color="#EF4444" />
              <KpiTile label="Pendientes" value={String(f.pending)} icon="clock" color="#F59E0B" />
              <KpiTile label="Por vencer" value={String(f.expiring)} icon="calendar" color="#F97316" />
            </KpiGrid>
            {f.vehicles.length === 0 ? <p className="py-6 text-center text-sm text-muted">No hay vehículos registrados.</p> : f.vehicles.map((v) => {
              const st = FLEET_STATUS[v.status] ?? { label: v.status ? v.status.replace(/_/g, ' ') : 'Sin estado', color: '#8CA3B0' };
              return (
                <div key={v.plate} className="panel flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{v.plate}</p>
                    <p className="text-xs text-muted">{[v.site, days('SOAT', v.soat), days('Tecnomecánica', v.tecno)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Pill label={st.label} color={st.color} compact />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export function SettlementTowerPage() {
  const navigate = useNavigate();
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage | ''>('');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['tr', 'tower', periodId], queryFn: () => fetchSettlements(periodId) });
  const periods = useQuery({ queryKey: ['tr', 'periods'], queryFn: fetchSettlementPeriods });
  const all = useMemo(() => q.data?.value ?? [], [q.data]);
  // Totales sobre TODO lo cargado, sin filtros (igual que Flutter: los kpis del servidor excluyen rechazados).
  const totals = useMemo(() => {
    const t: Record<Stage, number> = { aprobado: 0, preliquidado: 0, enProceso: 0, rechazado: 0, anulado: 0 };
    for (const p of all) t[stageOf(p.status)] += packageValue(p);
    return t;
  }, [all]);
  const term = search.trim().toLowerCase();
  const shown = all.filter((p) => (!stage || stageOf(p.status) === stage) && (!term || p.code.toLowerCase().includes(term) || p.carrierName.toLowerCase().includes(term)));

  return (
    <div className="pb-10">
      <ScreenHeader title="Torre de liquidaciones" />
      <div className="space-y-3 p-3">
        <p className="text-[13px] text-muted">Revisa las liquidaciones de transporte, valores y estado de cada paquete.</p>
        {q.isLoading ? <CenterSpinner /> : q.error ? (
          <EmptyState icon="alert" title="No se pudo cargar la torre" message={(q.error as Error).message} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <CacheNote on={q.data?.fromCache} />
            <KpiGrid cols={2}>
              <KpiTile label="Aprobado" value={formatCop(totals.aprobado)} icon="checkCircle" color="#16A34A" />
              <KpiTile label="Preliquidado" value={formatCop(totals.preliquidado)} icon="file" color="#3B82F6" />
              <KpiTile label="En proceso" value={formatCop(totals.enProceso)} icon="clock" color="#64748B" />
              <KpiTile label="Rechazado" value={formatCop(totals.rechazado)} icon="x" color="#EF4444" />
            </KpiGrid>
            <input type="search" className="field" placeholder="Buscar por código o transportador" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <SelectField<Stage | ''> label="Estado" value={stage} options={[['', 'Todos los estados'], ...(['enProceso', 'preliquidado', 'aprobado', 'rechazado', 'anulado'] as Stage[]).map((s): [Stage, string] => [s, STAGE_LABEL[s]])]} onChange={setStage} />
              <SelectField<number | ''> label="Periodo" value={periodId ?? ''} options={[['', 'Todos los periodos'], ...(periods.data?.value ?? []).map((p): [number, string] => [p.id, p.label])]} onChange={(v) => setPeriodId(v === '' ? null : Number(v))} />
            </div>
            <p className="text-xs text-muted">{shown.length} registros</p>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{all.length === 0 ? 'Aún no hay paquetes de liquidación.' : 'Ningún paquete coincide con el filtro.'}</p>
            ) : shown.map((p) => {
              const s = stageOf(p.status);
              const v = packageValue(p);
              return (
                <button key={p.id} type="button" onClick={() => navigate(`/transporte/liquidaciones/${p.id}`)} className="panel block w-full p-3 text-left active:opacity-80">
                  <div className="flex items-center gap-2">
                    <Pill label={statusLabel(p.status)} color={STAGE_COLOR[s]} compact />
                    {p.blocking > 0 && <Pill label={`${p.blocking} bloqueo(s)`} color="#F59E0B" compact />}
                    <b className="ml-auto text-sm">{p.code}</b>
                  </div>
                  <div className="mt-1.5 flex items-start gap-2">
                    <p className="line-clamp-2 min-w-0 flex-1 text-sm">{p.carrierName}</p>
                    <span className={`font-bold ${v === 0 ? 'text-teal' : 'text-ok'}`}>{formatCop(v)}</span>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                    <Icon name="calendar" size={13} />
                    {p.start && p.end ? `${shortDate(d(p.start))} - ${shortDate(d(p.end))}` : p.periodCode || 'Sin periodo'}
                    <Icon name="chevron" size={14} className="ml-auto" />
                  </p>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export function SettlementDetailPage() {
  const id = Number(useParams().id);
  const q = useQuery({ queryKey: ['tr', 'pkg', id], queryFn: () => fetchPackage(id) });
  const data = q.data?.value;
  const plates = [...new Set((data?.items ?? []).map((i) => i.plate).filter(Boolean))];
  return (
    <div className="pb-10">
      <ScreenHeader title="Liquidación" />
      <div className="space-y-3 p-3">
        {q.isLoading ? <CenterSpinner /> : q.error || !data ? (
          <EmptyState icon="alert" title="No se pudo cargar la liquidación" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <CacheNote on={q.data?.fromCache} />
            <Panel>
              <div className="flex items-center justify-between gap-2"><b className="text-lg">{data.pkg.code}</b><Pill label={statusLabel(data.pkg.status)} color={STAGE_COLOR[stageOf(data.pkg.status)]} /></div>
              <p className="text-sm text-muted">{data.pkg.carrierName}</p>
            </Panel>
            <KpiGrid cols={2}>
              <KpiTile label="Calculado" value={formatCop(data.pkg.calculated)} icon="money" />
              <KpiTile label="Ajustado" value={formatCop(data.pkg.adjusted)} icon="money" color="#F59E0B" />
              <KpiTile label="Aprobado" value={formatCop(data.pkg.approved)} icon="checkCircle" color="#16A34A" />
              <KpiTile label="Contabilizado" value={formatCop(data.pkg.accounted)} icon="receipt" color="#8B5CF6" />
            </KpiGrid>
            <p className="text-sm text-muted">{data.items.length} servicios{plates.length ? ` · placas: ${plates.join(', ')}` : ''}</p>
            {data.items.length === 0 ? <p className="py-6 text-center text-sm text-muted">El paquete no tiene servicios cargados.</p> : data.items.map((i, k) => (
              <div key={k} className="panel flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Guía {i.guide}</p>
                  {i.route && <p className="truncate text-xs text-muted">{i.route}</p>}
                  <p className="text-xs text-muted">Placa: {i.plate ?? '—'}{i.date ? ` · ${shortDate(d(i.date))}` : ''}</p>
                </div>
                <span className="font-bold text-ok">{formatCop(i.amount)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function TransportConfigPage() {
  const q = useQuery({ queryKey: ['tr', 'config'], queryFn: fetchTransportConfig });
  const c = q.data?.value;
  return (
    <div className="pb-10">
      <ScreenHeader title="Configuración" />
      <div className="space-y-3 p-3">
        {q.isLoading ? <CenterSpinner /> : q.error || !c ? (
          <EmptyState icon="alert" title="No se pudo cargar la configuración" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <CacheNote on={q.data?.fromCache} />
            <KpiTile label="Impuesto régimen simple (PYG)" value={formatPct(c.taxPercent, 2)} caption="Se aplica sobre los ingresos de cada placa." icon="receipt" />
            <Panel>
              <p className="font-bold">Tipos de liquidación</p>
              <p className="mb-2 text-xs text-muted">{c.types.length} configurados</p>
              {c.types.length === 0 ? <p className="text-sm text-muted">No hay tipos de liquidación.</p> : c.types.map((t) => (
                <div key={t.code} className="flex items-center gap-2 border-b border-line/60 py-2">
                  <div className="min-w-0 flex-1"><p className="text-sm">{t.name}</p><p className="text-xs text-faint">{t.reinforced ? `${t.code} · aprobación reforzada` : t.code}</p></div>
                  <Pill label={t.active ? 'Activo' : 'Inactivo'} color={t.active ? '#16A34A' : '#718A98'} compact />
                </div>
              ))}
            </Panel>
            <ReadOnlyNote title="Solo consulta" message="Estos parámetros los cambia desde la web un usuario con permiso de escritura en Transporte." />
          </>
        )}
      </div>
    </div>
  );
}
