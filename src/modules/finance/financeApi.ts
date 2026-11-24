import { Api } from '../../config/endpoints';
import { asBool, asDouble, asDoubleOrNull, asInt, asMap, asMapList, asString, asStringOrNull, type Json } from '../../core/json';
import { calendarDay } from '../../core/format';
import { api, canUseCache, isNetworkError } from '../../services/apiClient';
import { cachedFetch } from '../../storage/cache';

/** Todas son de SOLO LECTURA (`accounting:read`). Se cachean para ver sin señal. */
const cached = <T,>(key: string, f: () => Promise<T>) => cachedFetch(key, f, canUseCache);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado');

export interface Totals { debit: number; credit: number; balance: number }
export interface AccountRow { code: string; name: string; debit: number; credit: number; balance: number }
export interface Aging { total: number; buckets: Record<string, number>; documents: AgingDoc[] }
export interface AgingDoc { number: string; party: string; balance: number; daysOverdue: number; dueDate: string | null }
export interface LedgerEntry { date: string | null; description: string; debit: number; credit: number }

const totals = (j: unknown): Totals => {
  const m = asMap(j);
  return { debit: asDouble(m.debit), credit: asDouble(m.credit), balance: asDouble(m.balance ?? m.payable) };
};
const accountRow = (m: Json): AccountRow => ({
  code: asString(m.code), name: asString(m.name), debit: asDouble(m.debit), credit: asDouble(m.credit), balance: asDouble(m.balance ?? m.payable),
});
const iso = (v: unknown) => calendarDay(v)?.toISOString() ?? null;

function aging(j: unknown): Aging {
  const m = asMap(j);
  const b = asMap(m.buckets);
  return {
    total: asDouble(m.total),
    buckets: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, asDouble(v)])),
    documents: asMapList(m.documents).map((d) => ({
      number: asStringOrNull(d.number) ?? '—',
      party: asStringOrNull(asMap(d.party).name) ?? 'Sin tercero',
      balance: asDouble(d.balance),
      daysOverdue: asInt(d.days_overdue),
      dueDate: iso(d.due_date ?? d.date),
    })),
  };
}
export const bucket = (a: Aging, k: string) => a.buckets[k] ?? 0;

export interface Summary {
  balance: { assets: number; liabilities: number; equity: number } | null;
  operatingProfit: number | null;
  trial: { rows: AccountRow[]; totals: Totals; balanced: boolean } | null;
  taxes: { rows: AccountRow[]; totals: Totals } | null;
  receivables: Aging | null;
  payables: Aging | null;
  ledger: { code: string; name: string; totals: Totals; entries: LedgerEntry[] } | null;
  periodStatus: string;
  errors: Record<string, string>;
}

/** 8 consultas en paralelo; cada sección falla por separado. */
export async function fetchSummary(period: string, account: string) {
  return cached(`fin:summary:${period}:${account}`, async (): Promise<Summary> => {
    const errors: Record<string, string> = {};
    const safe = async <T,>(key: string, f: () => Promise<T>): Promise<T | null> => {
      try {
        return await f();
      } catch (e) {
        if (isNetworkError(e)) throw e;
        errors[key] = errMsg(e);
        return null;
      }
    };
    const q = { period };
    const [bal, inc, trial, tax, rec, pay, led, per] = await Promise.all([
      safe('balance', () => api.get(Api.balanceSheet, q)),
      safe('income', () => api.get(Api.incomeStatement, q)),
      safe('trial', () => api.get(Api.trialBalance, q)),
      safe('taxes', () => api.get(Api.taxReport, q)),
      safe('receivables', () => api.get(Api.receivables)),
      safe('payables', () => api.get(Api.payables)),
      safe('ledger', () => api.get(Api.ledger(account), q)),
      safe('periods', () => api.get(Api.accountingPeriods)),
    ]);
    const s: Summary = {
      balance: bal ? { assets: asDouble(asMap(asMap(bal).assets).total), liabilities: asDouble(asMap(asMap(bal).liabilities).total), equity: asDouble(asMap(asMap(bal).equity).total) } : null,
      operatingProfit: inc ? asDouble(asMap(inc).operating_profit) : null,
      trial: trial ? { rows: asMapList(asMap(trial).rows).map(accountRow), totals: totals(asMap(trial).totals), balanced: asMap(trial).balanced !== false } : null,
      taxes: tax ? { rows: asMapList(asMap(tax).taxes).map(accountRow), totals: totals(asMap(tax).totals) } : null,
      receivables: rec ? aging(rec) : null,
      payables: pay ? aging(pay) : null,
      ledger: led
        ? {
            code: asString(asMap(asMap(led).account).code),
            name: asString(asMap(asMap(led).account).name),
            totals: totals(asMap(led).totals),
            entries: asMapList(asMap(led).entries).map((e) => ({
              date: iso(e.date),
              description: asStringOrNull(e.description) ?? asStringOrNull(e.reference) ?? asStringOrNull(e.source_type) ?? 'Movimiento',
              debit: asDouble(e.debit),
              credit: asDouble(e.credit),
            })),
          }
        : null,
      periodStatus: asString(asMap(asMap(per)[period]).status, 'open'),
      errors,
    };
    if (!s.balance && s.operatingProfit === null && !s.trial && !s.taxes && !s.receivables && !s.payables) {
      throw new Error(Object.values(errors)[0] ?? 'No fue posible cargar los reportes');
    }
    return s;
  });
}

export const PERIOD_STATUS: Record<string, { label: string; color: string }> = {
  closed: { label: 'Cerrado', color: '#EF4444' },
  review: { label: 'En revisión', color: '#F59E0B' },
  open: { label: 'Abierto', color: '#2DD4BF' },
};

export interface LedgerAccount { code: string; name: string; type: string }
export const TYPE_LABEL: Record<string, string> = { asset: 'Activo', liability: 'Pasivo', equity: 'Patrimonio', income: 'Ingreso', expense: 'Gasto' };

export const fetchAccounts = () =>
  cached('fin:accounts', async () =>
    asMapList(await api.get(Api.accounts, { active: 'true' })).map<LedgerAccount>((a) => ({ code: asString(a.code), name: asString(a.name), type: asString(a.type) })),
  );

export interface AccountingDoc { number: string; postingDate: string | null; headerText: string; totalDebit: number; totalCredit: number; cancelled: boolean }
export const fetchDocuments = (period: string) =>
  cached(`fin:docs:${period}`, async () =>
    asMapList(asMap(await api.get(Api.accountingDocuments, { period, limit: '100' })).documents).map<AccountingDoc>((d) => ({
      number: asStringOrNull(d.full_number) ?? asStringOrNull(d.document_number) ?? '—',
      postingDate: iso(d.posting_date),
      headerText: asString(d.header_text),
      totalDebit: asDouble(d.total_debit),
      totalCredit: asDouble(d.total_credit),
      cancelled: asBool(d.is_cancelled),
    })),
  );

export const fetchAging = (receivable: boolean) =>
  cached(`fin:aging:${receivable ? 'cxc' : 'cxp'}`, async () => aging(await api.get(receivable ? Api.receivables : Api.payables)));

/* ---------------- PYG interactivo ---------------- */

export interface PygEntry { key: string; actual: number; prior: number; variationPct: number | null; budgetStatus: string }
export interface PygNode { key: string; code: string; name: string; level: number; actual: number; prior: number; difference: number; hasMovement: boolean; children: PygNode[] }
export interface PygDim { code: string; name: string; branchCode: string | null }
export interface InteractivePyg {
  period: string; mode: string; sections: PygEntry[]; net: PygEntry; nodes: PygNode[];
  branches: PygDim[]; costCenters: PygDim[]; warnings: string[];
  range: string; priorRange: string; isEmpty: boolean;
  linkage: { ledgerEntries: number; linked: number; orphan: number; ambiguous: number };
}

const entry = (m: Json): PygEntry => ({ key: asString(m.key), actual: asDouble(m.actual), prior: asDouble(m.prior), variationPct: asDoubleOrNull(m.variation_pct), budgetStatus: asString(m.budget_status) });
const node = (m: Json): PygNode => ({
  key: asString(m.key), code: asString(m.code), name: asStringOrNull(m.name) ?? asString(m.code), level: asInt(m.level),
  actual: asDouble(m.actual), prior: asDouble(m.prior), difference: asDouble(m.difference), hasMovement: asBool(m.has_movement),
  children: asMapList(m.children).map(node),
});
const dim = (m: Json): PygDim => ({ code: asString(m.code), name: asStringOrNull(m.name) ?? asString(m.code), branchCode: asStringOrNull(m.branch_code) });

export function fetchPyg(p: { period: string; mode: string; dims: string[]; branch: string | null; costCenter: string | null }) {
  return cached(`fin:pyg:${JSON.stringify(p)}`, async (): Promise<InteractivePyg> => {
    const m = asMap(await api.get(Api.pygInteractive, {
      period: p.period, mode: p.mode, dimensions: p.dims.join(','), branch: p.branch ?? undefined, cost_center: p.costCenter ?? undefined,
    }));
    const org = asMap(m.organization);
    const r = asMap(m.range);
    const pr = asMap(m.prior_range);
    const link = asMap(m.linkage);
    const sections = asMapList(m.sections).map(entry);
    return {
      period: asString(m.period, p.period), mode: asString(m.mode, 'month'), sections, net: entry(asMap(m.net)),
      nodes: asMapList(m.nodes).map(node),
      branches: asMapList(org.branches).map(dim), costCenters: asMapList(org.cost_centers).map(dim),
      warnings: asMapList(m.warnings).map((w) => asString(w.message)).filter(Boolean),
      range: `${asString(r.start)} a ${asString(r.end)}`, priorRange: `${asString(pr.start)} a ${asString(pr.end)}`,
      isEmpty: m.is_empty === undefined ? sections.length === 0 : asBool(m.is_empty),
      linkage: { ledgerEntries: asInt(link.ledger_entries), linked: asInt(link.linked), orphan: asInt(link.orphan), ambiguous: asInt(link.ambiguous) },
    };
  });
}

export interface BudgetRow { title: string; scope: string; amount: number }
export const fetchPygBudget = (period: string) =>
  cached(`fin:pyg-budget:${period}`, async () => {
    const m = asMap(await api.get(Api.pygBudgets, { period }));
    const rows = asMapList(m.rows).map<BudgetRow>((r) => {
      const code = asString(r.account_code);
      const name = asString(r.account_name);
      return {
        title: code ? `${code} · ${name}` : name || `Cuenta ${asInt(r.account_id)}`,
        scope: [asStringOrNull(r.branch_code) && `Sucursal ${r.branch_code}`, asStringOrNull(r.cost_center_code) && `Centro ${r.cost_center_code}`].filter(Boolean).join(' · '),
        amount: asDouble(r.amount),
      };
    });
    return { period: asString(m.period, period), rows, total: rows.reduce((s, r) => s + r.amount, 0) };
  });

/* ---------------- PYG por vehículo ---------------- */

export interface VehicleRow { code: string; name: string; kind: string; budget: number; actual: number; cump: number | null }
export interface VehicleStatement { plate: string; label: string; incomeActual: number; rows: VehicleRow[] }
const KIND: Record<string, string> = {
  income: 'ingreso', ingreso: 'ingreso', expense: 'gasto', gasto: 'gasto', tax: 'impuesto', impuesto: 'impuesto',
  subtotal_gastos_operativos: 'gastosOperacionales', subtotal_utilidad_operacional: 'utilidadOperacional',
  subtotal_utilidad_antes_provisiones: 'utilidadAntesProvisiones', subtotal_utilidad_neta: 'utilidadNeta',
};
export const KIND_BADGE: Record<string, string> = {
  ingreso: 'INGRESO', gasto: 'GASTO', gastosOperacionales: 'GASTOS OPERACIONALES', utilidadOperacional: 'UTILIDAD OPERACIONAL',
  utilidadAntesProvisiones: 'UTILIDAD ANTES DE PROVISIONES', impuesto: 'IMPUESTO', utilidadNeta: 'UTILIDAD NETA', otro: '',
};
export const isSubtotal = (k: string) => ['gastosOperacionales', 'utilidadOperacional', 'utilidadAntesProvisiones', 'utilidadNeta'].includes(k);
const statement = (m: Json): VehicleStatement => ({
  plate: asString(m.plate), label: asString(m.vehicle_label), incomeActual: asDouble(m.income_actual),
  rows: asMapList(m.rows).map((r) => ({ code: asString(r.code), name: asStringOrNull(r.name) ?? asString(r.code), kind: KIND[asString(r.kind)] ?? 'otro', budget: asDouble(r.budget), actual: asDouble(r.actual), cump: asDoubleOrNull(r.cump) })),
});
export const byKind = (s: VehicleStatement, k: string) => s.rows.find((r) => r.kind === k)?.actual ?? 0;

export const fetchVehiclePyg = (period: string) =>
  cached(`fin:vpyg:${period}`, async () => {
    const m = asMap(await api.get(Api.pygReport, { period }));
    const ds = asMap(m.data_status);
    const taxPercent = asDouble(m.tax_percent);
    const avisos: string[] = [];
    if (asInt(ds.vehicle_count) > 0 && asInt(ds.vehicles_with_income) === 0) avisos.push('Ningún vehículo tiene ingresos liquidados en el periodo.');
    if (asDouble(ds.unmapped_total) > 0) avisos.push('Hay gasto sin concepto asignado: revisa el mapeo de fuentes.');
    if (taxPercent === 0) avisos.push('El impuesto de régimen simple está en 0%: revísalo en configuración.');
    return { taxPercent, vehicles: asMapList(m.vehicles).map(statement), corporate: statement(asMap(m.corporate)), avisos };
  });

export const fetchPygConfig = () =>
  cached('fin:pyg-config', async () => {
    const [cfg, map] = await Promise.all([api.get(Api.pygConfig), api.get(Api.pygMapping)]);
    return {
      taxPercent: asDouble(asMap(cfg).tax_percent),
      mapping: asMapList(asMap(map).rows).map((r) => ({ sourceType: asString(r.source_type), sourceCode: asString(r.source_code), conceptCode: asString(r.pyg_concept_code), active: r.active !== false })),
    };
  });
