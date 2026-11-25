import type { PunchType } from './attendanceApi';

/** Marcación propia tal como la devuelve `/hr/self/attendance?flat=1`. */
export interface HistoryPunch {
  type: PunchType;
  date: string; // AAAA-MM-DD
  time: string; // HH:MM o HH:MM:SS
  extraMinutes: number;
}

export interface HistoryDay {
  date: string;
  entrada: string | null;
  salida: string | null;
  /** Minutos entre entrada y salida, descontando el almuerzo si tiene sus dos marcas. */
  workedMinutes: number | null;
  lunchMinutes: number | null;
  extraMinutes: number;
  punches: number;
  /** Tiene entrada pero no salida: jornada sin cerrar. */
  open: boolean;
}

export interface HistorySummary {
  days: HistoryDay[];
  daysWorked: number;
  punches: number;
  workedMinutes: number;
  extraMinutes: number;
  daysWithExtra: number;
  openDays: number;
}

const minutes = (hhmm: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Resumen del historial: horas trabajadas salen de las marcas del día (entrada → salida,
 * menos el almuerzo si tiene inicio y fin). Las extras son las que registró el servidor en
 * cada marcación (`minutos_extra`); no se recalculan en el celular.
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
      const lunchStart = minutes(first('inicio_almuerzo'));
      const lunchEnd = minutes(last('fin_almuerzo'));
      const lunchMinutes = lunchStart !== null && lunchEnd !== null && lunchEnd > lunchStart ? lunchEnd - lunchStart : null;
      const a = minutes(entrada);
      const b = minutes(salida);
      const span = a !== null && b !== null && b > a ? b - a : null;
      return {
        date,
        entrada,
        salida,
        workedMinutes: span === null ? null : Math.max(0, span - (lunchMinutes ?? 0)),
        lunchMinutes,
        extraMinutes: list.reduce((n, p) => n + Math.max(0, p.extraMinutes || 0), 0),
        punches: list.length,
        open: entrada !== null && salida === null,
      };
    });
  return {
    days,
    daysWorked: days.filter((d) => d.entrada !== null).length,
    punches: punches.length,
    workedMinutes: days.reduce((n, d) => n + (d.workedMinutes ?? 0), 0),
    extraMinutes: days.reduce((n, d) => n + d.extraMinutes, 0),
    daysWithExtra: days.filter((d) => d.extraMinutes > 0).length,
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
