import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { OutlineButton, Panel, Pill, PrimaryButton, ScreenHeader } from '../../components/ui';
import { formatDateTime } from '../../core/format';
import { db, OUTBOX_KIND_LABEL, requestPersistentStorage, storageEstimate, type OutboxStatus } from '../../storage/db';
import { useSync } from '../../sync/SyncProvider';

const STATUS: Record<OutboxStatus, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#F59E0B' },
  enviando: { label: 'Enviando', color: '#2DD4BF' },
  enviada: { label: 'Subida', color: '#16A34A' },
  fallida: { label: 'Fallida', color: '#EF4444' },
};

/**
 * Centro de sincronización: estado de cada operación, botón manual,
 * reintentar/descartar, almacenamiento y bitácora.
 */
export function SyncCenterPage() {
  const { entries, online, syncing, sync, lastSyncAt, lastReport, retryFailed, discardFailed, failedCount, openCount } = useSync();
  const { toast, confirm } = useFeedback();
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const log = useLiveQuery(() => db.syncLog.orderBy('at').reverse().limit(30).toArray(), []) ?? [];

  useEffect(() => {
    void storageEstimate().then(setStorage);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [entries.length]);

  const now = async () => {
    if (!online) {
      toast('Sin conexión: se sincronizará al recuperar la señal', 'warn');
      return;
    }
    const r = await sync({ force: true });
    if (!r) return;
    toast(r.aborted ? 'La sesión expiró: vuelve a ingresar para enviar' : `Enviadas ${r.sent} · En espera ${r.deferred} · Fallidas ${r.failed}`, r.failed || r.aborted ? 'warn' : 'ok');
  };

  return (
    <div className="pb-10">
      <ScreenHeader title="Sincronización" />
      <div className="space-y-3 p-3">
        <Panel>
          <div className="flex items-center gap-3">
            <Icon name={online ? 'wifi' : 'cloudOff'} className={online ? 'text-teal' : 'text-faint'} />
            <div className="flex-1">
              <p className="font-bold">{online ? 'Con conexión' : 'Sin conexión'}</p>
              <p className="text-xs text-muted">
                {lastSyncAt ? `Última sincronización: ${formatDateTime(new Date(lastSyncAt))}` : 'Aún no se ha sincronizado en esta sesión'}
                {lastReport && ` · ${lastReport.sent} enviada(s)`}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-surface-alt p-2"><p className="text-xl font-bold text-warn">{openCount}</p><p className="text-xs text-muted">Por subir</p></div>
            <div className="rounded-xl bg-surface-alt p-2"><p className="text-xl font-bold text-bad">{failedCount}</p><p className="text-xs text-muted">Fallidas</p></div>
          </div>
          <PrimaryButton className="mt-3" icon="sync" busy={syncing} onClick={() => void now()}>Sincronizar ahora</PrimaryButton>
          {failedCount > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <OutlineButton icon="refresh" onClick={() => void retryFailed()}>Reintentar</OutlineButton>
              <OutlineButton tone="red" icon="trash" onClick={async () => {
                if (await confirm({ title: 'Descartar operaciones', message: 'Se van a eliminar las operaciones que no se pudieron enviar. Lo que ya llegó al servidor no se toca.', confirm: 'Descartar', danger: true })) await discardFailed();
              }}>Descartar</OutlineButton>
            </div>
          )}
        </Panel>

        <h2 className="px-1 pt-1 text-sm font-bold text-muted">Operaciones en este teléfono</h2>
        {entries.length === 0 ? (
          <p className="px-1 text-sm text-muted">No hay operaciones guardadas.</p>
        ) : (
          [...entries].reverse().map((e) => (
            <div key={e.id} className="panel p-3">
              <div className="flex items-center gap-2">
                <b className="flex-1 text-sm">{OUTBOX_KIND_LABEL[e.kind]}</b>
                <Pill label={STATUS[e.status].label} color={STATUS[e.status].color} compact />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {formatDateTime(new Date(e.createdAt))}
                {e.orderId !== 0 && ` · Orden ${e.orderId}`}
                {e.attempts > 0 && ` · ${e.attempts} intento(s)`}
                {e.nextAttemptAt && e.status === 'pendiente' && ` · próximo intento ${formatDateTime(new Date(e.nextAttemptAt))}`}
              </p>
              {e.lastError && <p className="mt-1 text-xs text-bad">{e.lastError}</p>}
              <p className="mt-1 font-mono text-[10px] text-faint">{e.clientUuid}</p>
            </div>
          ))
        )}

        <Panel>
          <p className="font-bold">Almacenamiento</p>
          <p className="text-xs text-muted">
            {storage ? `Usado ${(storage.usage / 1048576).toFixed(1)} MB de ${(storage.quota / 1048576).toFixed(0)} MB disponibles.` : 'El navegador no informa el espacio.'}
          </p>
          <p className="mt-1 text-xs text-muted">
            Almacenamiento persistente: {persisted === null ? 'desconocido' : persisted ? 'activo (el navegador no lo borrará por falta de espacio)' : 'no concedido'}
          </p>
          {persisted === false && (
            <OutlineButton className="mt-2 w-full" onClick={async () => setPersisted(await requestPersistentStorage())}>Solicitar almacenamiento persistente</OutlineButton>
          )}
        </Panel>

        {log.length > 0 && (
          <Panel>
            <p className="mb-1 font-bold">Bitácora</p>
            {log.map((l) => (
              <p key={l.id} className={`text-[11.5px] ${l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-muted'}`}>
                {formatDateTime(new Date(l.at))} · {l.message}
              </p>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}
