import { describe, expect, it } from 'vitest';
import { formatDuration, nightMinutesIn, summarizeHistory, type HistoryPunch } from './history';

const p = (date: string, type: HistoryPunch['type'], time: string, extraMinutes = 0): HistoryPunch => ({ date, type, time, extraMinutes });

describe('historial: horas laboradas diurnas y nocturnas', () => {
  const summary = summarizeHistory([
    // 07:00 → 17:30 con almuerzo 12:00-13:00: 9 h 30 min, todas diurnas; 30 min extra del servidor.
    p('2026-11-20', 'entrada', '07:00'),
    p('2026-11-20', 'inicio_almuerzo', '12:00'),
    p('2026-11-20', 'fin_almuerzo', '13:00'),
    p('2026-11-20', 'salida', '17:30:00', 30),
    // 14:00 → 22:00 sin almuerzo: 5 h diurnas (14-19) y 3 h nocturnas (19-22).
    p('2026-11-21', 'entrada', '14:00'),
    p('2026-11-21', 'salida', '22:00'),
    // 22:00 → 06:30 (pasa la medianoche): 8 h nocturnas (22-06) y 30 min diurnas (06-06:30).
    p('2026-11-22', 'entrada', '22:00'),
    p('2026-11-22', 'salida', '06:30'),
    // Jornada abierta: solo entrada.
    p('2026-11-23', 'entrada', '21:41'),
  ]);

  it('separa cada día en laboradas, diurnas y nocturnas', () => {
    const day = (d: string) => summary.days.find((x) => x.date === d)!;
    expect(day('2026-11-20')).toMatchObject({ workedMinutes: 570, dayMinutes: 570, nightMinutes: 0, lunchMinutes: 60, extraMinutes: 30 });
    expect(day('2026-11-21')).toMatchObject({ workedMinutes: 480, dayMinutes: 300, nightMinutes: 180 });
    expect(day('2026-11-22')).toMatchObject({ workedMinutes: 510, dayMinutes: 30, nightMinutes: 480 });
    expect(day('2026-11-23')).toMatchObject({ open: true, workedMinutes: null, dayMinutes: null, nightMinutes: null });
  });

  it('consolida el total del rango', () => {
    expect(summary).toMatchObject({ daysWorked: 4, workedMinutes: 570 + 480 + 510, dayMinutes: 570 + 300 + 30, nightMinutes: 180 + 480, extraMinutes: 30, openDays: 1 });
    expect(summary.days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20']);
  });

  it('el almuerzo nocturno se descuenta de las nocturnas', () => {
    const s = summarizeHistory([
      p('2026-11-24', 'entrada', '18:00'),
      p('2026-11-24', 'inicio_almuerzo', '20:00'),
      p('2026-11-24', 'fin_almuerzo', '20:30'),
      p('2026-11-24', 'salida', '23:00'),
    ]);
    // 18-20 (1 h diurna + 1 h nocturna) + 20:30-23 (2 h 30 nocturnas) = 4 h 30.
    expect(s.days[0]).toMatchObject({ workedMinutes: 270, dayMinutes: 60, nightMinutes: 210, lunchMinutes: 30 });
  });

  it('franja nocturna 19:00 a 06:00', () => {
    expect(nightMinutesIn(18 * 60, 20 * 60)).toBe(60);
    expect(nightMinutesIn(5 * 60, 7 * 60)).toBe(60);
    expect(nightMinutesIn(8 * 60, 17 * 60)).toBe(0);
    expect(nightMinutesIn(22 * 60, (24 + 6) * 60)).toBe(480);
  });

  it('sin marcaciones queda en cero y el formato es legible', () => {
    expect(summarizeHistory([])).toMatchObject({ daysWorked: 0, workedMinutes: 0, dayMinutes: 0, nightMinutes: 0, days: [] });
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(65)).toBe('1 h 05 min');
    expect(formatDuration(825)).toBe('13 h 45 min');
  });
});
