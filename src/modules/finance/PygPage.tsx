import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { KpiGrid, KpiTile, PillTabs, SelectField } from '../../components/report';
import { CenterSpinner, EmptyState, InfoBox, Panel, ScreenHeader } from '../../components/ui';
import { formatCop, formatMonto, formatPct, periodLabel, periodOf, recentPeriods } from '../../core/format';
import { useUser } from '../auth/AuthProvider';
import {
  byKind, fetchPyg, fetchPygBudget, fetchPygConfig, fetchVehiclePyg, isSubtotal, KIND_BADGE, type PygEntry, type PygNode,
} from './financeApi';

const SECTION: Record<string, { label: string; icon: IconName }> = {
  ingresos4: { label: 'Ingresos', icon: 'chart' },
  gastos5: { label: 'Gastos', icon: 'arrow' },
  costos6: { label: 'Costos', icon: 'settings' },
  costosproduccion7: { label: 'Costos producción', icon: 'tool' },
  no_clasificado: { label: 'Fuera del PUC', icon: 'info' },
  '': { label: 'Utilidad neta', icon: 'money' },
};
const DIM_NAME: Record<string, string> = { puc: 'Cuenta PUC', branch: 'Sucursal', cost_center: 'Centro de costo' };
const PRESETS = [['puc', 'branch', 'cost_center'], ['branch', 'puc', 'cost_center'], ['cost_center', 'puc', 'branch']];
const periods24 = (): [string, string][] => recentPeriods(new Date(), 24).map((p) => [p, periodLabel(p)]);

/** PYG interactivo (port de `pyg_interactive_screen.dart`). Solo consulta. */
export function PygPage() {
  const [view, setView] = useState<'puc' | 'vehiculo'>('puc');
  const [period, setPeriod] = useState(periodOf(new Date()));
  return (
    <div className="min-h-full pb-10">
      <ScreenHeader title="PYG interactivo" />
      <div className="mx-3 mt-3 grid grid-cols-2 rounded-[14px] border border-line bg-surface-alt p-1">
        {([['puc', 'Contable · PUC'], ['vehiculo', 'Por vehículo']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`min-h-10 rounded-[10px] text-sm font-bold ${view === k ? 'bg-teal/15 text-teal' : 'text-muted'}`}>{l}</button>
        ))}
      </div>
      {view === 'puc' ? <PucView period={period} setPeriod={setPeriod} /> : <VehicleView period={period} setPeriod={setPeriod} />}
    </div>
  );
}

function PucView({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const user = useUser();
  const [mode, setMode] = useState<'month' | 'ytd'>('month');
  const [preset, setPreset] = useState(0);
  const [branch, setBranch] = useState<string | null>(null);
  const [cc, setCc] = useState<string | null>(null);
  const [tab, setTab] = useState<'matriz' | 'presupuesto'>('matriz');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ['fin', 'pyg', period, mode, preset, branch, cc],
    queryFn: () => fetchPyg({ period, mode, dims: PRESETS[preset], branch, costCenter: cc }),
  });
  const budget = useQuery({ queryKey: ['fin', 'pyg-budget', period], queryFn: () => fetchPygBudget(period), enabled: tab === 'presupuesto' });
  const d = q.data?.value;
  const centers = (d?.costCenters ?? []).filter((c) => !branch || c.branchCode === branch);
  const visible = (d?.nodes ?? []).filter((n) => n.hasMovement);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const expandAll = () => {
    const keys = new Set<string>();
    const walk = (ns: PygNode[]) => ns.forEach((n) => { if (n.children.length) { keys.add(n.key); walk(n.children); } });
    walk(visible);
    setOpen(keys);
  };
  const link = d?.linkage;

  return (
    <div className="space-y-3 p-3">
      <div className="panel grid grid-cols-2 gap-2 p-3">
        <SelectField label="Periodo" value={period} options={periods24()} onChange={setPeriod} />
        <label className="block">
          <span className="mb-1 block text-[12px] text-muted">Rango</span>
          <button type="button" className="field py-2.5 text-left" onClick={() => setMode((m) => (m === 'month' ? 'ytd' : 'month'))}>{mode === 'month' ? 'Mes' : 'Año'}</button>
        </label>
        <div className="col-span-2">
          <SelectField label="Agrupación (orden de columnas)" value={preset} options={PRESETS.map((p, i) => [i, p.map((x) => DIM_NAME[x]).join(' · ')])} onChange={(v) => setPreset(Number(v))} />
        </div>
        <SelectField label="Sucursal" value={branch ?? ''} options={[['', 'Todas'], ...(d?.branches ?? []).map((b): [string, string] => [b.code, b.name])]} onChange={(v) => { setBranch(v || null); setCc(null); }} />
        <SelectField label="Centro de costo" value={cc ?? ''} options={[['', 'Todos'], ...centers.map((c): [string, string] => [c.code, c.name])]} onChange={(v) => setCc(v || null)} />
      </div>
      <PillTabs tabs={[['matriz', 'Matriz interactiva'], ['presupuesto', 'Presupuesto PYG']]} value={tab} onChange={setTab} />

      {tab === 'presupuesto' ? (
        budget.isLoading ? <CenterSpinner /> : budget.error ? (
          <EmptyState icon="alert" title="No se pudo cargar el presupuesto" message={(budget.error as Error).message} onRetry={() => void budget.refetch()} />
        ) : !budget.data || budget.data.value.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No hay presupuesto cargado para este periodo. Se carga desde el monitor web, en Contabilidad.</p>
        ) : (
          <>
            <Panel>
              <p className="text-[11px] font-bold tracking-wider text-muted">PRESUPUESTO DEL PERIODO</p>
              <p className="text-2xl font-bold text-teal">{formatMonto(budget.data.value.total)}</p>
              <p className="text-xs text-muted">{budget.data.value.rows.length} línea(s) en {periodLabel(budget.data.value.period)}</p>
            </Panel>
            {budget.data.value.rows.map((r, i) => (
              <div key={i} className="panel flex items-center gap-2 p-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{r.title}</p>{r.scope && <p className="text-xs text-muted">{r.scope}</p>}</div>
                <span className="text-sm font-bold">{formatMonto(r.amount)}</span>
              </div>
            ))}
          </>
        )
      ) : q.isLoading ? <CenterSpinner /> : q.error || !d ? (
        <EmptyState icon="alert" title="No se pudo cargar el PYG" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          {q.data?.fromCache && <InfoBox tone="warn" icon="cloudOff">Sin conexión: datos guardados en el teléfono.</InfoBox>}
          <div className="grid grid-cols-2 gap-2">
            {[...d.sections, d.net].map((s) => <SectionCard key={s.key || 'net'} e={s} net={s === d.net} />)}
          </div>
          <Panel>
            <h3 className="font-bold">{mode === 'month' ? 'Matriz mensual' : 'Matriz año corrido'} · {d.period}</h3>
            <p className="text-xs text-muted">{d.range} · Año anterior {d.priorRange}</p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted">{visible.length} {visible.length === 1 ? 'registro' : 'registros'}</span>
              {visible.length > 0 && (
                <button type="button" className="min-h-9 font-semibold text-teal" onClick={() => (open.size ? setOpen(new Set()) : expandAll())}>
                  {open.size ? 'Contraer todo' : 'Expandir todo'}
                </button>
              )}
            </div>
            {d.isEmpty || visible.length === 0 ? (
              <p className="py-4 text-sm text-muted">No hay movimientos contables en {user.tenantName || 'empresa sin nombre'} durante {periodLabel(d.period)}.</p>
            ) : (
              <div className="mt-1">{visible.map((n) => <NodeRow key={n.key} n={n} open={open} toggle={toggle} />)}</div>
            )}
            {link && (
              <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">
                Enlace contable: {link.ledgerEntries} asientos · {formatPct(link.ledgerEntries ? (link.linked / link.ledgerEntries) * 100 : 0)} con metadata · {link.orphan} sin comprobante · {link.ambiguous} con metadata múltiple
                <br />Empresa: {user.tenantName}
              </p>
            )}
          </Panel>
          {d.warnings.map((w, i) => <InfoBox key={i} tone="warn" icon="alert">{w}</InfoBox>)}
        </>
      )}
    </div>
  );
}

function SectionCard({ e, net }: { e: PygEntry; net: boolean }) {
  const meta = SECTION[e.key] ?? { label: e.key, icon: 'chart' as IconName };
  return (
    <div className="panel p-3" style={net ? { borderColor: '#2DD4BF' } : undefined}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted uppercase"><Icon name={meta.icon} size={13} />{meta.label}</p>
      <p className={`truncate font-bold ${net ? 'text-[19px]' : 'text-base'} ${e.actual < 0 ? 'text-bad' : ''}`}>{net ? formatCop(e.actual) : formatMonto(e.actual)}</p>
      <p className="text-[11px] text-faint">Año anterior {formatMonto(e.prior)} · {formatPct(e.variationPct)}</p>
      {e.budgetStatus === 'partial' && <p className="text-[11px] text-warn">Presupuesto parcial</p>}
    </div>
  );
}

function NodeRow({ n, open, toggle }: { n: PygNode; open: Set<string>; toggle: (k: string) => void }) {
  const kids = n.children.filter((c) => c.hasMovement);
  const isOpen = open.has(n.key);
  return (
    <div>
      <button type="button" onClick={() => toggle(n.key)} className="flex w-full items-center gap-1 py-2 text-left text-[13px]" style={{ paddingLeft: 4 + n.level * 14 }}>
        <span className="w-4 text-faint">{kids.length > 0 && <Icon name={isOpen ? 'back' : 'chevron'} size={14} className={isOpen ? '-rotate-90' : ''} />}</span>
        <span className={`min-w-0 flex-1 truncate ${n.level === 0 ? 'font-bold' : ''}`}>{n.code ? `${n.code} · ${n.name}` : n.name}</span>
        <span className={n.actual < 0 ? 'text-bad' : ''}>{formatMonto(n.actual)}</span>
      </button>
      {isOpen && (
        <>
          <div className="mb-1 grid grid-cols-3 gap-1 rounded-lg bg-surface-alt p-2 text-center text-[11.5px]" style={{ marginLeft: 4 + n.level * 14 }}>
            <span><span className="block text-faint">Actual</span>{formatMonto(n.actual)}</span>
            <span><span className="block text-faint">Año anterior</span>{formatMonto(n.prior)}</span>
            <span className={n.difference < 0 ? 'text-bad' : ''}><span className="block text-faint">Diferencia</span>{formatMonto(n.difference)}</span>
          </div>
          {kids.map((c) => <NodeRow key={c.key} n={c} open={open} toggle={toggle} />)}
        </>
      )}
    </div>
  );
}

function VehicleView({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const [sub, setSub] = useState<'consolidado' | 'vehiculo' | 'config'>('consolidado');
  const [plate, setPlate] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['fin', 'vpyg', period], queryFn: () => fetchVehiclePyg(period) });
  const cfg = useQuery({ queryKey: ['fin', 'pyg-config'], queryFn: fetchPygConfig, enabled: sub === 'config' });
  const r = q.data?.value;
  const st = r ? (sub === 'vehiculo' && plate ? r.vehicles.find((v) => v.plate === plate) ?? r.corporate : r.corporate) : null;

  return (
    <div className="space-y-3 p-3">
      <PillTabs tabs={[['consolidado', 'Consolidado'], ['vehiculo', 'Por vehículo'], ['config', 'Configuración']]} value={sub} onChange={setSub} />
      {sub === 'config' ? (
        cfg.isLoading ? <CenterSpinner /> : cfg.error || !cfg.data ? (
          <EmptyState icon="alert" title="No se pudo cargar la configuración" message={(cfg.error as Error)?.message} onRetry={() => void cfg.refetch()} />
        ) : (
          <>
            <Panel>
              <p className="text-[11px] font-bold tracking-wider text-muted">IMPUESTO RÉGIMEN SIMPLE</p>
              <p className="text-2xl font-bold text-teal">{formatPct(cfg.data.value.taxPercent, 2)}</p>
              <p className="text-xs text-muted">Tarifa aplicada sobre los ingresos para calcular la utilidad neta de cada placa.</p>
            </Panel>
            <Panel>
              <p className="font-bold">Mapeo de fuentes</p>
              <p className="text-xs text-muted">Qué fuente alimenta cada concepto. Lo que no tiene regla cae en "sin clasificar".</p>
              <p className="my-2 text-xs text-muted">{cfg.data.value.mapping.filter((m) => m.active).length} de {cfg.data.value.mapping.length} regla(s) activa(s)</p>
              {cfg.data.value.mapping.length === 0 ? <p className="text-sm text-muted">No hay reglas de mapeo configuradas.</p> : cfg.data.value.mapping.map((m, i) => (
                <div key={i} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[13px]">
                  <Icon name={m.active ? 'checkCircle' : 'x'} size={15} className={m.active ? 'text-teal' : 'text-faint'} />
                  <span className="min-w-0 flex-1"><span className="block truncate">{m.sourceCode}</span><span className="text-[11px] text-faint">{m.sourceType}</span></span>
                  <Icon name="arrow" size={14} className="text-faint" />
                  <span>{m.conceptCode}</span>
                </div>
              ))}
              <p className="mt-2 text-[11px] text-faint">Los rangos PUC y el mapeo se editan desde el monitor web: desde el móvil son de consulta.</p>
            </Panel>
          </>
        )
      ) : q.isLoading ? <CenterSpinner /> : q.error || !r || !st ? (
        <EmptyState icon="alert" title="No se pudo cargar el PYG por vehículo" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="panel grid grid-cols-2 gap-2 p-3">
            {sub === 'vehiculo' && (
              <SelectField label="Vehículo" value={plate ?? ''} options={[['', 'Toda la flota'], ...r.vehicles.map((v): [string, string] => [v.plate, `${v.label ? `${v.plate} · ${v.label}` : v.plate} · ${formatMonto(v.incomeActual)}`])]} onChange={(v) => setPlate(v || null)} />
            )}
            <div className={sub === 'vehiculo' ? '' : 'col-span-2'}>
              <SelectField label="Periodo" value={period} options={periods24()} onChange={setPeriod} />
            </div>
          </div>
          {r.avisos.length > 0 && (
            <InfoBox tone="warn" icon="alert">
              <b>{r.avisos.length} aviso(s) del PYG por vehículo</b>
              {r.avisos.map((a) => <span key={a} className="block">· {a}</span>)}
            </InfoBox>
          )}
          <KpiGrid cols={2}>
            <KpiTile label="INGRESOS" value={formatMonto(st.incomeActual)} caption={`Impuesto ${formatPct(r.taxPercent, 2)}`} icon="chart" />
            <KpiTile label="UTILIDAD OPERACIONAL" value={formatMonto(byKind(st, 'utilidadOperacional'))} caption={`Gastos ${formatMonto(byKind(st, 'gastosOperacionales'))}`} icon="money" />
          </KpiGrid>
          <KpiTile highlight label="UTILIDAD NETA" value={formatMonto(byKind(st, 'utilidadNeta'))} caption={`Impuesto ${formatMonto(byKind(st, 'impuesto'))}`} icon="money" />
          <Panel>
            <h3 className="font-bold">Estado de resultados</h3>
            <p className="text-xs text-muted">{sub === 'vehiculo' && plate ? `Placa ${plate}` : 'Consolidado de la flota'} en {periodLabel(period)}.</p>
            {st.rows.length === 0 ? <p className="py-4 text-sm text-muted">No hay conceptos configurados para este periodo.</p> : st.rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-line/60 py-2 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${row.kind === 'utilidadNeta' ? 'text-teal' : ''} ${isSubtotal(row.kind) ? 'font-bold' : ''}`}>{row.name}</p>
                  <p className="text-[10px] text-faint">{KIND_BADGE[row.kind]}</p>
                  {row.cump !== null && <p className="text-[10.5px] text-muted">Cumplimiento {formatPct(row.cump)}</p>}
                </div>
                <span className="w-[86px] text-right text-muted">{row.budget > 0 ? formatMonto(row.budget) : '—'}</span>
                <span className={`w-[86px] text-right ${row.actual < 0 ? 'text-bad' : ''}`}>{formatMonto(row.actual)}</span>
              </div>
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}
