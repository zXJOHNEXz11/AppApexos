import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export function Spinner({ size = 22, className = 'text-teal' }: { size?: number; className?: string }) {
  return <span className={`spinner inline-block ${className}`} style={{ width: size, height: size }} role="status" aria-label="Cargando" />;
}

export function CenterSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <Spinner />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function Panel({ children, className = '', onClick, border }: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  border?: string;
}) {
  const cls = `panel p-4 ${onClick ? 'cursor-pointer active:opacity-80 text-left w-full block' : ''} ${className}`;
  const style = border ? { borderColor: border } : undefined;
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick}>
      {children}
    </button>
  ) : (
    <div className={cls} style={style}>
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; icon?: IconName };

/** Botón principal con el degradado de marca (GradientButton). */
export function PrimaryButton({ children, busy, icon, className = '', disabled, ...rest }: BtnProps) {
  const off = disabled || busy;
  return (
    <button
      type="button"
      {...rest}
      disabled={off}
      className={`flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-bold text-white ${
        off ? 'bg-surface-high text-faint opacity-60' : 'grad-brand active:opacity-85'
      } ${className}`}
    >
      {busy ? <Spinner size={20} className="text-white" /> : (
        <>
          {children}
          {icon && <Icon name={icon} size={19} />}
        </>
      )}
    </button>
  );
}

export function SolidButton({ children, busy, icon, className = '', disabled, tone = 'teal', ...rest }: BtnProps & { tone?: 'teal' | 'red' | 'amber' }) {
  const off = disabled || busy;
  const bg = tone === 'red' ? 'bg-bad' : tone === 'amber' ? 'bg-warn' : 'bg-teal-solid';
  return (
    <button
      type="button"
      {...rest}
      disabled={off}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold ${
        off ? 'bg-surface-high text-faint' : `${bg} text-white active:opacity-85`
      } ${className}`}
    >
      {busy ? <Spinner size={18} className="text-white" /> : (
        <>
          {icon && <Icon name={icon} size={18} />}
          {children}
        </>
      )}
    </button>
  );
}

export function OutlineButton({ children, icon, className = '', tone = 'teal', ...rest }: BtnProps & { tone?: 'teal' | 'red' | 'muted' }) {
  const color = tone === 'red' ? 'text-bad border-bad/60' : tone === 'muted' ? 'text-muted border-line' : 'text-teal border-line';
  return (
    <button
      type="button"
      {...rest}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-[14px] border px-4 text-[15px] font-semibold disabled:opacity-40 active:opacity-80 ${color} ${className}`}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function EmptyState({ icon = 'info', title, message, onRetry }: {
  icon?: IconName;
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center px-8 py-10 text-center">
      <Icon name={icon} size={44} className="text-faint" />
      <p className="mt-3.5 text-base font-semibold text-ink">{title}</p>
      {message && <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-snug text-muted">{message}</p>}
      {onRetry && (
        <OutlineButton icon="refresh" className="mt-4 w-[180px]" onClick={onRetry}>
          Reintentar
        </OutlineButton>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  agendado: '#3B82F6',
  pendiente: '#F59E0B',
  en_curso: '#2DD4BF',
  inspeccion: '#2DD4BF',
  ejecucion: '#2DD4BF',
  bloqueada: '#F59E0B',
  cerrada: '#16A34A',
  completada: '#16A34A',
  no_ejecutada: '#EF4444',
  cancelada: '#EF4444',
};

export function Pill({ label, color, compact }: { label: string; color: string; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border font-semibold ${compact ? 'px-2 py-[3px] text-[11px]' : 'px-2.5 py-[5px] text-xs'}`}
      style={{ color, background: `${color}24`, borderColor: `${color}59` }}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status, label, compact }: { status: string; label: string; compact?: boolean }) {
  return <Pill label={label} color={STATUS_COLORS[status] ?? '#718A98'} compact={compact} />;
}

/** Encabezado de pantalla interna con botón atrás (respeta el notch). */
export function ScreenHeader({ title, subtitle, back = true, right }: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface-alt/95 backdrop-blur">
      <div className="flex min-h-14 items-center gap-1 px-2 py-1.5">
        {back && (
          <button type="button" aria-label="Volver" onClick={() => navigate(-1)} className="flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-white/5">
            <Icon name="back" size={24} />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${back ? '' : 'pl-3'}`}>
          <h1 className="truncate text-[17px] font-bold">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function GradientTile({ icon, gradient = 'teal', size = 52 }: { icon: IconName; gradient?: string; size?: number }) {
  return (
    <span className={`grad-${gradient} flex shrink-0 items-center justify-center text-white`} style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <Icon name={icon} size={Math.round(size * 0.46)} />
    </span>
  );
}

export function ModuleCard({ icon, gradient, title, subtitle, badge, onClick, disabled }: {
  icon: IconName;
  gradient: string;
  title: string;
  subtitle: string;
  badge?: string | null;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`panel flex w-full items-center gap-3.5 p-3.5 text-left ${disabled ? 'opacity-55' : 'active:opacity-80'}`}
    >
      <GradientTile icon={icon} gradient={gradient} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-extrabold">{title}</span>
          {badge && <span className="rounded-full bg-warn/15 px-2 py-[3px] text-[10.5px] font-bold text-warn">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-tight text-muted">{subtitle}</span>
      </span>
      <Icon name="chevron" size={24} className="text-teal" />
    </button>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-xl font-extrabold">{children}</h2>
      <span className="grad-brand mt-1.5 block h-[3px] w-[46px] rounded" />
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[13px] font-semibold text-muted">{children}</p>;
}

export function InfoBox({ children, tone = 'info', icon = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'bad' | 'ok'; icon?: IconName }) {
  const c = { info: '#3B82F6', warn: '#F59E0B', bad: '#EF4444', ok: '#2DD4BF' }[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-[14px] border p-3 text-[13px] leading-snug" style={{ background: `${c}1A`, borderColor: `${c}52`, color: tone === 'info' ? '#E6EDF3' : c }}>
      <Icon name={icon} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
