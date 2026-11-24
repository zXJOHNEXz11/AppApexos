/** Formatos (port de `core/format.dart` y `core/money.dart`). */
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatDate(d: Date | null): string {
  if (!d) return 'Sin fecha';
  return `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDateTime(d: Date | null): string {
  if (!d) return '-';
  return `${formatDate(d)} · ${formatTime(d)}`;
}

export function formatRelativeDay(d: Date | null): string {
  if (!d) return 'Sin fecha';
  const today = new Date();
  const t = new Date(today);
  t.setDate(t.getDate() + 1);
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, t)) return 'Mañana';
  if (sameDay(d, y)) return 'Ayer';
  return `${d.getDate()} ${SHORT[d.getMonth()]}`;
}

export function formatQuantity(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v);
}

/** `$ 150.000`; `-$ 2.501`. Sin decimales ni abreviaturas. */
export function formatCop(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${r < 0 ? '-' : ''}$ ${s}`;
}

/** Estilo contable: negativos entre paréntesis. */
export function formatMonto(n: number): string {
  return n < 0 ? `(${formatCop(Math.abs(n))})` : formatCop(n);
}

export function formatPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return `${s.replace('.', ',')}%`;
}

export function periodLabel(p: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (!m) return p;
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS[idx]} de ${m[1]}` : p;
}

export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function recentPeriods(now = new Date(), count = 18): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(periodOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}

/** Fechas `@db.Date` (medianoche UTC): se toman los componentes sin convertir. */
export function calendarDay(v: unknown): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function shortDate(d: Date | null): string {
  return d ? `${d.getDate()} ${SHORT[d.getMonth()]} ${d.getFullYear()}` : '';
}

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
