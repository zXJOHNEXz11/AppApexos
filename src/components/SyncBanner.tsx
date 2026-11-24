import { useState } from 'react';
import { env } from '../config/env';
import { OUTBOX_KIND_LABEL } from '../storage/db';
import { outboxBannerMessage, useSync } from '../sync/SyncProvider';
import { BottomSheet, useFeedback } from './feedback';
import { Icon } from './Icon';
import { Spinner } from './ui';

/**
 * Aviso de la cola (port de `OutboxBanner`): pendientes en ámbar, fallidas en
 * rojo con su motivo, y las acciones Reintentar / Descartar.
 */
export function SyncBanner() {
  const { openCount, failedCount, syncing, entries, retryFailed, discardFailed } = useSync();
  const { confirm, toast } = useFeedback();
  const [sheet, setSheet] = useState(false);
  if (openCount === 0 && failedCount === 0) return null;

  const failed = entries.filter((e) => e.status === 'fallida');
  const color = failedCount > 0 ? '#EF4444' : '#F59E0B';
  const first = failed[0];

  const discard = async () => {
    const ok = await confirm({
      title: 'Descartar operaciones',
      message: 'Se van a eliminar las operaciones que no se pudieron enviar. Lo que ya llegó al servidor no se toca.',
      confirm: 'Descartar',
      danger: true,
    });
    if (ok) await discardFailed();
  };

  const copy = async () => {
    const report = failed.length === 0
      ? 'No hay operaciones fallidas.'
      : [
          `APEXOS · ${failed.length} operación(es) fallida(s)`,
          `Ambiente: ${env.environment} (${env.apiBaseUrl})`,
          '',
          ...failed.map((e) =>
            [
              `— ${OUTBOX_KIND_LABEL[e.kind]}`,
              `  ${e.method} ${e.path}`,
              `  encolada: ${new Date(e.createdAt).toISOString()}`,
              `  intentos: ${e.attempts}`,
              `  error: ${e.lastError ?? '(sin motivo guardado)'}`,
              '',
            ].join('\n'),
          ),
        ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
      toast('Detalle copiado. Pégalo donde lo pidan.', 'ok');
    } catch {
      toast('No se pudo copiar en este navegador', 'bad');
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2.5" style={{ background: `${color}1F`, borderColor: `${color}40`, color }}>
        {syncing && failedCount === 0 ? <Spinner size={14} className="text-warn" /> : <Icon name={failedCount > 0 ? 'alert' : 'upload'} size={18} />}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => failedCount > 0 && setSheet(true)}>
          <span className="text-[13px] font-semibold">{outboxBannerMessage(failedCount, openCount)}</span>
          {first && (
            <span className="mt-0.5 line-clamp-3 block text-[11.5px] text-ink">
              {OUTBOX_KIND_LABEL[first.kind]}: {first.lastError}
            </span>
          )}
        </button>
        {failedCount > 0 && (
          <>
            <button type="button" className="min-h-12 px-2 text-[13px] font-bold text-ink" onClick={() => void retryFailed()}>
              Reintentar
            </button>
            <button type="button" className="min-h-12 px-2 text-[13px] font-semibold text-muted" onClick={() => void discard()}>
              Descartar
            </button>
          </>
        )}
      </div>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Envíos que no salieron">
        <p className="mb-3 text-[13px] text-muted">
          Lo que sigue en la cola espera detrás de estos. Reintenta si fue falta de señal, o descarta si ya no aplican.
        </p>
        <div className="space-y-2">
          {failed.map((e) => (
            <div key={e.id} className="rounded-[14px] border border-bad/35 bg-surface-alt p-3">
              <div className="flex items-center gap-2">
                <Icon name="alert" size={16} className="text-bad" />
                <span className="flex-1 text-[13.5px] font-bold">{OUTBOX_KIND_LABEL[e.kind]}</span>
                {e.orderId !== 0 && <span className="text-[11.5px] text-faint">Orden {e.orderId}</span>}
              </div>
              <p className="mt-1 text-[13px] text-muted">{e.lastError ?? 'El servidor no explicó el motivo.'}</p>
              {e.attempts > 0 && <p className="mt-0.5 text-[11.5px] text-faint">{e.attempts} intento{e.attempts === 1 ? '' : 's'}</p>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => void copy()} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-line font-semibold text-teal">
          <Icon name="copy" size={18} /> Copiar detalle del error
        </button>
      </BottomSheet>
    </>
  );
}

/** Indicador compacto de conexión/sincronización para los encabezados. */
export function ConnectionPill() {
  const { online, syncing, openCount, failedCount, sync } = useSync();
  const state = !online ? 'offline' : failedCount > 0 ? 'error' : syncing ? 'syncing' : openCount > 0 ? 'pending' : 'ok';
  const cfg = {
    offline: { c: '#718A98', t: 'Sin conexión', i: 'cloudOff' as const },
    error: { c: '#EF4444', t: 'Con errores', i: 'alert' as const },
    syncing: { c: '#2DD4BF', t: 'Sincronizando', i: 'sync' as const },
    pending: { c: '#F59E0B', t: `${openCount} por subir`, i: 'upload' as const },
    ok: { c: '#2DD4BF', t: 'Al día', i: 'cloud' as const },
  }[state];
  return (
    <button
      type="button"
      onClick={() => void sync({ force: true })}
      aria-label={`Estado: ${cfg.t}. Tocar para sincronizar`}
      className="flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold"
      style={{ color: cfg.c, borderColor: `${cfg.c}59`, background: `${cfg.c}1A` }}
    >
      {state === 'syncing' ? <Spinner size={12} className="" /> : <Icon name={cfg.i} size={14} />}
      {cfg.t}
    </button>
  );
}
