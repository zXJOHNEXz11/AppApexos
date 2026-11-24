import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../app/TopBar';
import { Icon } from '../../components/Icon';
import { AccountTable, KpiGrid, KpiTile, PillTabs, ReadOnlyNote, ReportSection, SelectField, TotalsStrip } from '../../components/report';
import { CenterSpinner, EmptyState, InfoBox, Pill } from '../../components/ui';
import { formatCop, periodLabel, recentPeriods, shortDate } from '../../core/format';
import { bucket, fetchAccounts, fetchAging, fetchDocuments, fetchSummary, PERIOD_STATUS, TYPE_LABEL, type Aging } from './financeApi';

type Tab = 'resumen' | 'cuentas' | 'asientos' | 'cxp' | 'cxc';
const TABS: [Tab, string][] = [['resumen', 'Resumen'], ['cuentas', 'Plan de cuentas'], ['asientos', 'Asientos'], ['cxp', 'Cuentas por pagar'], ['cxc', 'Cuentas por cobrar']];
const dateOf = (s: string | null) => (s ? new Date(s) : null);

/** Reportes financieros (port de `finance_reports_screen.dart`). Solo consulta. */
export function FinancePage() {
  const [tab, setTab] = useState<Tab>('resumen');
  const [period, setPeriod] = useState(recentPeriods()[0]);
  return (
    <div className="pb-nav">
      <TopBar title="Reportes financieros" />
      <PillTabs tabs={TABS} value={tab} onChange={setTab} />
      <div className="space-y-3 px-3 pt-1">
        {tab === 'resumen' && <SummaryTab period={period} setPeriod={setPeriod} />}
        {tab === 'cuentas' && <AccountsTab />}
        {tab === 'asientos' && <DocumentsTab period={period} setPeriod={setPeriod} />}
        {tab === 'cxp' && <AgingTab receivable={false} />}
        {tab === 'cxc' && <AgingTab receivable />}
      </div>
    </div>
  );
}

const periodOptions = (): [string, string][] => recentPeriods().map((p) => [p, periodLabel(p)]);

function CacheNote({ fromCache }: { fromCache?: boolean }) {
  return fromCache ? <InfoBox tone="warn" icon="cloudOff">Sin conexión: datos guardados en el teléfono.</InfoBox> : null;
}

function SummaryTab({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const [account, setAccount] = useState('1305');
  const navigate = useNavigate();
  const accounts = useQuery({ queryKey: ['fin', 'accounts'], queryFn: fetchAccounts });
  const q = useQuery({ queryKey: ['fin', 'summary', period, account], queryFn: () => fetchSummary(period, account) });
  const s = q.data?.value;
  const aux = useMemo(() => {
    const list = (accounts.data?.value ?? []).filter((a) => a.code.length >= 4).map((a): [string, string] => [a.code, `${a.code} ${a.name}`]);
    return list.some(([c]) => c === account) ? list : [[account, account] as [string, string], ...list];
  }, [accounts.data, account]);
  const ps = PERIOD_STATUS[s?.periodStatus ?? 'open'] ?? PERIOD_STATUS.open;
  const v = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatCop(n));

  return (
    <>
      <div className="panel space-y-2.5 p-3">
        <SelectField label="Periodo" value={period} options={periodOptions()} onChange={setPeriod} />
        <SelectField label="Cuenta auxiliar" value={account} options={aux} onChange={setAccount} />
        {s && <div className="flex items-center justify-between text-sm"><span className="text-muted">Estado periodo</span><Pill label={ps.label} color={ps.color} /></div>}
      </div>
      <button type="button" onClick={() => navigate('/reportes/pyg')} className="panel flex w-full items-center gap-3 p-3.5 text-left">
        <span className="grad-violet flex h-11 w-11 items-center justify-center rounded-xl text-white"><Icon name="chart" /></span>
        <span className="flex-1">
          <b className="block">PYG interactivo</b>
          <span className="text-[12.5px] text-muted">Resultado por sucursal y centro de costo, contra presupuesto.</span>
        </span>
        <Icon name="chevron" className="text-teal" />
      </button>
      {q.isLoading ? <CenterSpinner /> : q.error || !s ? (
        <EmptyState icon="alert" title="No se pudieron cargar los reportes" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <CacheNote fromCache={q.data?.fromCache} />
          <KpiGrid>
            <KpiTile label="Activo" value={v(s.balance?.assets)} icon="money" />
            <KpiTile label="Pasivo" value={v(s.balance?.liabilities)} icon="money" color="#F59E0B" />
            <KpiTile label="Patrimonio" value={v(s.balance?.equity)} icon="shield" color="#8B5CF6" />
            <KpiTile label="Resultado operativo" value={v(s.operatingProfit)} icon="chart" />
            <KpiTile label="Impuestos por presentar" value={v(s.taxes?.totals.balance)} icon="receipt" color="#F59E0B" />
            <KpiTile label="Cartera pendiente" value={v(s.receivables?.total)} icon="file" color="#3B82F6" />
          </KpiGrid>
          <ReportSection title="Balance de prueba" subtitle={s.trial?.balanced === false ? 'Débitos y créditos descuadrados: revisar' : 'Débitos y créditos cuadrados'} error={s.errors.trial}>
            {s.trial && <><TotalsStrip {...s.trial.totals} />{s.trial.rows.length === 0 ? <p className="text-sm text-muted">Sin movimientos contables a este corte.</p> : <AccountTable rows={s.trial.rows} />}</>}
          </ReportSection>
          <ReportSection title="Impuestos y retenciones" subtitle="Base para preparar declaraciones y revisión fiscal" gradient="amber" icon="receipt" error={s.errors.taxes}>
            {s.taxes && <><TotalsStrip {...s.taxes.totals} />{s.taxes.rows.length === 0 ? <p className="text-sm text-muted">No hay impuestos contabilizados en el periodo.</p> : <AccountTable rows={s.taxes.rows} />}</>}
          </ReportSection>
          <ReportSection title="Auxiliar por cuenta" subtitle={s.ledger ? `${s.ledger.code} ${s.ledger.name}` : undefined} gradient="blue" icon="file" error={s.errors.ledger}>
            {s.ledger && (
              <>
                <TotalsStrip {...s.ledger.totals} />
                {s.ledger.entries.length === 0 ? <p className="text-sm text-muted">Sin movimientos para esta cuenta.</p> : (
                  [...s.ledger.entries].reverse().slice(0, 10).map((e, i) => (
                    <div key={i} className="flex items-center gap-2 border-b border-line/60 py-1.5 text-[13px]">
                      <span className="min-w-0 flex-1"><span className="block truncate">{e.description}</span><span className="text-[11px] text-faint">{shortDate(dateOf(e.date))}</span></span>
                      {e.debit !== 0 ? <span className="text-teal">{formatCop(e.debit)}</span> : <span className="text-warn">-{formatCop(e.credit)}</span>}
                    </div>
                  ))
                )}
              </>
            )}
          </ReportSection>
          <ReportSection title="Cartera y proveedores" subtitle="Cuentas por cobrar y pagar con vencimientos" gradient="violet" icon="users">
            <div className="grid grid-cols-2 gap-2">
              <AgingBox title="Por cobrar" a={s.receivables} err={s.errors.receivables} />
              <AgingBox title="Por pagar" a={s.payables} err={s.errors.payables} />
            </div>
          </ReportSection>
          <ReadOnlyNote
            title={`Periodo ${period}: ${ps.label.toLowerCase()}`}
            message="Un periodo cerrado bloquea nuevos asientos y pagos. El cierre lo hace contabilidad desde la web y queda auditado con usuario, fecha, valor anterior y valor nuevo; aquí es solo consulta."
          />
        </>
      )}
    </>
  );
}

function AgingBox({ title, a, err }: { title: string; a: Aging | null; err?: string }) {
  return (
    <div className="rounded-xl bg-surface-alt p-3 text-[12.5px]">
      <p className="text-muted">{title}</p>
      <p className="mb-1 text-[15px] font-bold">{a ? formatCop(a.total) : '—'}</p>
      {err ? <p className="text-bad">{err}</p> : a && (
        <>
          <p>0-30: {formatCop(bucket(a, 'current') + bucket(a, 'd30'))}</p>
          <p>31-60: {formatCop(bucket(a, 'd60'))}</p>
          <p>61-90: {formatCop(bucket(a, 'd90'))}</p>
          <p>+90: {formatCop(bucket(a, 'over90'))}</p>
        </>
      )}
    </div>
  );
}

function AccountsTab() {
  const q = useQuery({ queryKey: ['fin', 'accounts'], queryFn: fetchAccounts });
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const rows = (q.data?.value ?? []).filter((a) => !term || a.code.startsWith(term) || a.name.toLowerCase().includes(term));
  if (q.isLoading) return <CenterSpinner />;
  if (q.error) return <EmptyState icon="alert" title="No se pudo cargar" message={(q.error as Error).message} onRetry={() => void q.refetch()} />;
  return (
    <>
      <input type="search" className="field" placeholder="Buscar por código o nombre" value={search} onChange={(e) => setSearch(e.target.value)} />
      <p className="text-xs text-muted">{rows.length} cuentas</p>
      {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No hay cuentas que coincidan.</p> : (
        <div className="panel divide-y divide-line/60 px-2 py-1">
          {rows.slice(0, 400).map((a) => (
            <div key={a.code} className="flex items-center gap-2 py-2 text-[13px]" style={{ paddingLeft: 4 + (Math.min(Math.max(a.code.length, 1), 8) - 1) * 4 }}>
              <span className={`min-w-0 flex-1 truncate ${a.code.length <= 2 ? 'font-bold' : ''}`}>{a.code}&nbsp;&nbsp;{a.name}</span>
              <span className="text-[11px] text-faint">{TYPE_LABEL[a.type] ?? a.type}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DocumentsTab({ period, setPeriod }: { period: string; setPeriod: (p: string) => void }) {
  const q = useQuery({ queryKey: ['fin', 'docs', period], queryFn: () => fetchDocuments(period) });
  return (
    <>
      <SelectField label="Periodo" value={period} options={periodOptions()} onChange={setPeriod} />
      <CacheNote fromCache={q.data?.fromCache} />
      {q.isLoading ? <CenterSpinner /> : q.error ? <InfoBox tone="bad" icon="alert">{(q.error as Error).message}</InfoBox> :
        (q.data?.value.length ?? 0) === 0 ? <p className="py-6 text-center text-sm text-muted">No hay asientos en el periodo.</p> : (
          q.data!.value.map((d) => (
            <div key={d.number} className="panel p-3">
              <div className="flex items-center justify-between gap-2">
                <b className="truncate">{d.number}</b>
                {d.cancelled ? <Pill label="Anulado" color="#EF4444" compact /> : <span className="text-xs text-muted">{shortDate(dateOf(d.postingDate))}</span>}
              </div>
              {d.headerText && <p className="mt-0.5 text-[13px] text-muted">{d.headerText}</p>}
              <p className="mt-1 flex gap-4 text-[12.5px]"><span className="text-teal">Débito {formatCop(d.totalDebit)}</span><span className="text-warn">Crédito {formatCop(d.totalCredit)}</span></p>
            </div>
          ))
        )}
    </>
  );
}

function AgingTab({ receivable }: { receivable: boolean }) {
  const q = useQuery({ queryKey: ['fin', 'aging', receivable], queryFn: () => fetchAging(receivable) });
  if (q.isLoading) return <CenterSpinner />;
  if (q.error || !q.data) return <EmptyState icon="alert" title="No se pudo cargar" message={(q.error as Error)?.message} onRetry={() => void q.refetch()} />;
  const a = q.data.value;
  return (
    <>
      <CacheNote fromCache={q.data.fromCache} />
      <KpiGrid cols={2}>
        <KpiTile label={receivable ? 'Total por cobrar' : 'Total por pagar'} value={formatCop(a.total)} caption={`${a.documents.length} documentos abiertos`} icon="money" />
        <KpiTile label="Vencido más de 90 días" value={formatCop(bucket(a, 'over90'))} icon="alert" color="#EF4444" />
        <KpiTile label="0-30 días" value={formatCop(bucket(a, 'current') + bucket(a, 'd30'))} icon="clock" />
        <KpiTile label="31-90 días" value={formatCop(bucket(a, 'd60') + bucket(a, 'd90'))} icon="clock" color="#F59E0B" />
      </KpiGrid>
      {a.documents.length === 0 ? <p className="py-6 text-center text-sm text-muted">{receivable ? 'No hay cartera pendiente.' : 'No hay cuentas por pagar pendientes.'}</p> : (
        a.documents.map((d, i) => {
          const c = d.daysOverdue > 90 ? '#EF4444' : d.daysOverdue > 0 ? '#F59E0B' : '#2DD4BF';
          return (
            <div key={`${d.number}-${i}`} className="panel flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{d.party}</p>
                <p className="text-xs text-muted">{d.number} · vence {shortDate(dateOf(d.dueDate))}</p>
              </div>
              <div className="text-right">
                <p className="text-[13.5px] font-bold">{formatCop(d.balance)}</p>
                <p className="text-[11.5px]" style={{ color: c }}>{d.daysOverdue === 0 ? 'Al día' : `${d.daysOverdue} días vencido`}</p>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
