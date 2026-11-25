import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CenterSpinner, InfoBox, Panel } from '../../components/ui';
import { calendarDay, formatDate, todayIso } from '../../core/format';
import { fetchPunchHistory } from './attendanceApi';
import { formatDuration, summarizeHistory } from './history';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 15, label: '15 días' },
  { days: 30, label: '30 días' },
] as const;

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '--:--');

/** Consolidado del rango (laboradas, diurnas, nocturnas) y detalle por día. */
export function PunchHistory() {
  const [days, setDays] = useState<number>(7);
  const { from, to } = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    return { from: todayIso(start), to: todayIso(end) };
  }, [days]);
  const q = useQuery({ queryKey: ['hr', 'history', from, to], queryFn: () => fetchPunchHistory(from, to) });
  const summary = useMemo(() => summarizeHistory(q.data?.value ?? []), [q.data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Resumen</p>
        <div className="flex gap-1 rounded-xl border border-line bg-surface-alt p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`min-h-8 rounded-lg px-2.5 text-[12.5px] font-bold ${days === r.days ? 'bg-teal/15 text-teal' : 'text-muted'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <CenterSpinner label="Consultando tu historial..." />
      ) : q.isError && !q.data ? (
        <InfoBox tone="warn" icon="cloudOff">No fue posible consultar tu historial. Revisa la conexión e intenta de nuevo.</InfoBox>
      ) : (
        <>
          {q.data?.fromCache && <InfoBox tone="warn" icon="cloudOff">Sin conexión: se muestra la última copia guardada.</InfoBox>}
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Días trabajados" value={String(summary.daysWorked)} />
            <Stat label="Horas laboradas" value={formatDuration(summary.workedMinutes)} />
            <Stat label="Horas diurnas" value={formatDuration(summary.dayMinutes)} hint="6:00 a.m. – 7:00 p.m." />
            <Stat label="Horas nocturnas" value={formatDuration(summary.nightMinutes)} tone={summary.nightMinutes > 0 ? 'text-violet' : undefined} hint="7:00 p.m. – 6:00 a.m." />
          </div>
          {summary.extraMinutes > 0 && (
            <p className="text-[12.5px] text-muted">
              Extras registradas por el servidor en el rango: <b className="text-warn">{formatDuration(summary.extraMinutes)}</b>
            </p>
          )}
          {summary.openDays > 0 && (
            <InfoBox tone="warn" icon="alert">
              {summary.openDays === 1 ? 'Tienes 1 jornada sin marcar el fin.' : `Tienes ${summary.openDays} jornadas sin marcar el fin.`}
            </InfoBox>
          )}

          {summary.days.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No tienes marcaciones en este rango.</p>
          ) : (
            <div className="space-y-2">
              {summary.days.map((d) => (
                <Panel key={d.date}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{formatDate(calendarDay(d.date))}</p>
                      <p className="text-[12.5px] text-muted">
                        {hhmm(d.entrada)} – {d.salida ? hhmm(d.salida) : 'sin fin'}
                        {d.lunchMinutes ? ` · almuerzo ${formatDuration(d.lunchMinutes)}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${d.open ? 'text-warn' : ''}`}>
                        {d.workedMinutes !== null ? formatDuration(d.workedMinutes) : d.open ? 'Abierta' : '—'}
                      </p>
                      <p className="text-[11px] text-muted">laboradas</p>
                    </div>
                  </div>
                  {d.workedMinutes !== null && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
                      <span className="rounded-lg bg-surface-alt px-2.5 py-1.5">
                        <span className="text-muted">Diurnas </span>
                        <b>{formatDuration(d.dayMinutes ?? 0)}</b>
                      </span>
                      <span className="rounded-lg bg-surface-alt px-2.5 py-1.5">
                        <span className="text-muted">Nocturnas </span>
                        <b className={d.nightMinutes ? 'text-violet' : ''}>{formatDuration(d.nightMinutes ?? 0)}</b>
                      </span>
                    </div>
                  )}
                  {d.extraMinutes > 0 && <p className="mt-1.5 text-[12px] font-semibold text-warn">+{formatDuration(d.extraMinutes)} extra registradas</p>}
                </Panel>
              ))}
            </div>
          )}
          <p className="text-[11.5px] leading-relaxed text-faint">
            Las horas se calculan con tus marcas (entrada a fin, menos el almuerzo). Nocturnas: de 7:00 p.m. a 6:00 a.m., la franja por defecto de la nómina. La liquidación oficial (recargos y extras) la hace talento humano.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Panel>
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</p>
      <p className={`text-xl font-extrabold ${tone ?? ''}`}>{value}</p>
      {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
    </Panel>
  );
}
