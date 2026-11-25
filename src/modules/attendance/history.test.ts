import { describe, expect, it } from 'vitest';
import { formatDuration, summarizeHistory, type HistoryPunch } from './history';

const p = (date: string, type: HistoryPunch['type'], time: string, extraMinutes = 0): HistoryPunch => ({ date, type, time, extraMinutes });

describe('resumen del historial de marcaciones', () => {
  const summary = summarizeHistory([
    // Día completo: 07:00 a 17:30 con almuerzo de 1 h y 30 min extra registrados por el servidor.
    p('2026-11-20', 'entrada', '07:00'),
    p('2026-11-20', 'inicio_almuerzo', '12:00'),
    p('2026-11-20', 'fin_almuerzo', '13:00'),
    p('2026-11-20', 'salida', '17:30:00', 30),
    // Día sin almuerzo marcado: 08:00 a 12:15.
    p('2026-11-21', 'entrada', '08:00'),
    p('2026-11-21', 'salida', '12:15'),
    // Jornada abierta: solo entrada.
    p('2026-11-23', 'entrada', '07:05'),
  ]);

  it('cuenta días, marcaciones, horas trabajadas y extras', () => {
    expect(summary.daysWorked).toBe(3);
    expect(summary.punches).toBe(7);
    expect(summary.workedMinutes).toBe(9 * 60 + 30 + 4 * 60 + 15);
    expect(summary.extraMinutes).toBe(30);
    expect(summary.daysWithExtra).toBe(1);
    expect(summary.openDays).toBe(1);
  });

  it('ordena los días del más reciente al más antiguo y marca la jornada abierta', () => {
    expect(summary.days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-21', '2026-11-20']);
    expect(summary.days[0]).toMatchObject({ open: true, workedMinutes: null, salida: null });
    expect(summary.days[2]).toMatchObject({ lunchMinutes: 60, workedMinutes: 570, extraMinutes: 30 });
  });

  it('sin marcaciones el resumen queda en cero', () => {
    expect(summarizeHistory([])).toMatchObject({ daysWorked: 0, punches: 0, workedMinutes: 0, extraMinutes: 0, days: [] });
  });

  it('formato de duración legible', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(65)).toBe('1 h 05 min');
    expect(formatDuration(825)).toBe('13 h 45 min');
  });
});
