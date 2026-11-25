import type { PunchType } from './attendanceApi';

/** Marcación propia tal como la devuelve `/hr/self/attendance?flat=1`. */
export interface HistoryPunch {
  type: PunchType;
  date: string; // AAAA-MM-DD
  time: string; // HH:MM o HH:MM:SS
  extraMinutes: number;
}

/**
 * Franja nocturna: la misma por defecto de la nómina del servidor
 * (apps/api/src/modules/hr/service.js `night_start: "19:00"`, `night_end: "06:00"`).
 * La empresa puede cambiarla en sus parámetros de nómina; la liquidación oficial la hace
 * talento humano con esos parámetros.
 */
export const NIGHT_START_MINUTE = 19 * 60;
export const NIGHT_END_MINUTE = 6 * 60;

export interface HistoryDay {
  date: string;
  entrada: string | null;
  salida: string | null;
  /** Minutos laborados: entrada → fin, descontando el almuerzo si tiene sus dos marcas. */
  workedMinutes: number | null;
  dayMinutes: number | null;
  nightMinutes: number | null;
  lunchMinutes: number | null;
  extraMinutes: number;
  /** Tiene entrada pero no fin: jornada sin cerrar. */
  open: boolean;
}

export interface HistorySummary {
  days: HistoryDay[];
  daysWorked: number;
  workedMinutes: number;
  dayMinutes: number;
  nightMinutes: number;
  extraMinutes: number;
  openDays: number;
}

const minutes = (hhmm: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Minutos nocturnos dentro de [start, end), con minutos que pueden pasar de medianoche (hasta 2 días). */
export function nightMinutesIn(start: number, end: number, nightStart = NIGHT_START_MINUTE, nightEnd = NIGHT_END_MINUTE): number {
  let total = 0;
  for (let day = 0; day < 3; day++) {
    const base = day * 1440;
    for (const [a, b] of [[base, base + nightEnd], [base + nightStart, base + 1440]]) {
      total += Math.max(0, Math.min(end, b) - Math.max(start, a));
    }
  }
  return total;
}

/**
 * Resumen del historial con las marcas del día: horas laboradas (entrada → fin, menos el
 * almuerzo) separadas en diurnas y nocturnas. Un fin más temprano que la entrada se toma
 * como jornada que pasó la medianoche. Las extras son las que registró el servidor.
 */
export function summarizeHistory(punches: HistoryPunch[]): HistorySummary {
  const byDay = new Map<string, HistoryPunch[]>();
  for (const p of punches) {
    if (!p.date) continue;
    byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  }
  const days: HistoryDay[] = [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => {
      const first = (t: PunchType) => list.filter((p) => p.type === t).map((p) => p.time).sort()[0] ?? null;
      const last = (t: PunchType) => list.filter((p) => p.type === t).map((p) => p.time).sort().pop() ?? null;
      const entrada = first('entrada');
      const salida = last('salida');
      const start = minutes(entrada);
      let end = minutes(salida);
      if (start !== null && end !== null && end <= start) end += 1440; // pasó la medianoche
      let lunchStart = minutes(first('inicio_almuerzo'));
      let lunchEnd = minutes(last('fin_almuerzo'));
      if (start !== null && lunchStart !== null && lunchStart < start) lunchStart += 1440;
      if (start !== null && lunchEnd !== null && lunchEnd < start) lunchEnd += 1440;
      const lunchOk = lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart && (end === null || lunchEnd <= end);
      const lunchMinutes = lunchOk ? lunchEnd! - lunchStart! : null;

      let workedMinutes: number | null = null;
      let nightMinutes: number | null = null;
      if (start !== null && end !== null) {
        const segments: [number, number][] = lunchOk ? [[start, lunchStart!], [lunchEnd!, end]] : [[start, end]];
        workedMinutes = segments.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
        nightMinutes = segments.reduce((n, [a, b]) => n + nightMinutesIn(a, b), 0);
      }
      return {
        date,
        entrada,
        salida,
        workedMinutes,
        nightMinutes,
        dayMinutes: workedMinutes === null ? null : workedMinutes - (nightMinutes ?? 0),
        lunchMinutes,
        extraMinutes: list.reduce((n, p) => n + Math.max(0, p.extraMinutes || 0), 0),
        open: entrada !== null && salida === null,
      };
    });
  return {
    days,
    daysWorked: days.filter((d) => d.entrada !== null).length,
    workedMinutes: days.reduce((n, d) => n + (d.workedMinutes ?? 0), 0),
    dayMinutes: days.reduce((n, d) => n + (d.dayMinutes ?? 0), 0),
    nightMinutes: days.reduce((n, d) => n + (d.nightMinutes ?? 0), 0),
    extraMinutes: days.reduce((n, d) => n + d.extraMinutes, 0),
    openDays: days.filter((d) => d.open).length,
  };
}

/** 1 h 05 min · 45 min · 0 min */
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}
