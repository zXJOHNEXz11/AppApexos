import type { ReactNode } from 'react';
import { formatCop } from '../core/format';
import { Icon, type IconName } from './Icon';
import { GradientTile, InfoBox } from './ui';

/** Widgets de reportes (port de `report_widgets.dart`). */
export function KpiTile({ label, value, caption, icon = 'chart', color = '#2DD4BF', highlight }: {
  label: string; value: string; caption?: string; icon?: IconName; color?: string; highlight?: boolean;
}) {
  return (
    <div className="panel flex min-w-0 flex-col p-3" style={highlight ? { borderColor: '#2DD4BF' } : undefined}>
      <span className="mb-1.5 flex h-7 w-7 items-center justify-center rounded-full" style={{ background: `${color}26`, color }}>
        <Icon name={icon} size={15} />
      </span>
      <span className="line-clamp-2 text-[11.5px] text-muted">{label}</span>
      {/* Como el FittedBox de Flutter: el valor se achica para caber completo. */}
      <span
        className="font-bold whitespace-nowrap"
        style={{
          fontSize: value.length > 15 ? 12 : value.length > 12 ? 13.5 : value.length > 9 ? 15 : 17,
          ...(value.startsWith('-') || value.startsWith('(') ? { color: '#EF4444' } : {}),
        }}
      >
        {value}
      </span>
      {caption && <span className="mt-0.5 text-[11px] text-faint">{caption}</span>}
    </div>
  );
}

export function KpiGrid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-2 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>{children}</div>;
}

export function ReportSection({ title, subtitle, icon = 'chart', gradient = 'teal', error, children }: {
  title: string; subtitle?: string; icon?: IconName; gradient?: string; error?: string; children?: ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center gap-3">
        <GradientTile icon={icon} gradient={gradient} size={36} />
        <div className="min-w-0">
          <h3 className="text-[16.5px] font-bold">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {error ? <InfoBox tone="bad" icon="alert">{error}</InfoBox> : children}
    </section>
  );
}

export function TotalsStrip({ debit, credit, balance }: { debit: number; credit: number; balance: number }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
      {[['Débitos', debit], ['Créditos', credit], ['Saldo', balance]].map(([l, v]) => (
        <div key={l as string} className="rounded-lg bg-surface-alt px-1 py-2">
          <p className="text-[11px] text-muted">{l}</p>
          <p className="truncate text-[13px] font-semibold">{formatCop(v as number)}</p>
        </div>
      ))}
    </div>
  );
}

export function AccountTable({ rows }: { rows: { code: string; name: string; debit: number; credit: number }[] }) {
  return (
    <div className="text-[12.5px]">
      {rows.slice(0, 12).map((r) => (
        <div key={r.code + r.name} className="flex items-center gap-2 border-b border-line/60 py-1.5">
          <span className="w-12 shrink-0 font-semibold">{r.code}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{r.name}</span>
          <span className="w-[74px] truncate text-right">{formatCop(r.debit)}</span>
          <span className="w-[74px] truncate text-right">{formatCop(r.credit)}</span>
        </div>
      ))}
      {rows.length > 12 && <p className="pt-2 text-center text-xs text-muted">+ {rows.length - 12} cuentas más</p>}
    </div>
  );
}

export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-3 py-2">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={`min-h-10 shrink-0 rounded-full border px-4 text-[13px] font-semibold ${value === k ? 'border-teal/60 bg-teal/15 text-teal' : 'border-line text-muted'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function SelectField<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T | ''; options: [T | '', string][]; onChange: (v: T) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12px] text-muted">{label}</span>
      <select className="field py-2.5" value={String(value)} onChange={(e) => {
        const raw = e.target.value;
        const match = options.find(([v]) => String(v) === raw);
        onChange((match ? match[0] : raw) as T);
      }}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </label>
  );
}

export function ReadOnlyNote({ title, message }: { title: string; message: string }) {
  return (
    <div className="panel flex gap-3 p-4">
      <GradientTile icon="shield" gradient="blue" size={36} />
      <div>
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-[12.5px] text-muted">{message}</p>
      </div>
    </div>
  );
}
