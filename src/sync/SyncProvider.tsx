import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, type OutboxEntry } from '../storage/db';
import { outboxDao } from './outboxDao';
import type { OutboxDraft } from './outboxRequests';
import { ApiOutboxSender } from './sender';
import { OutboxSyncer, type SyncReport } from './syncer';

interface SyncState {
  online: boolean;
  syncing: boolean;
  lastReport: SyncReport | null;
  lastSyncAt: number | null;
  openCount: number;
  failedCount: number;
  entries: OutboxEntry[];
  enqueue: (drafts: OutboxDraft[]) => Promise<void>;
  /** `force`: adelanta el backoff de lo pendiente (botón manual / vuelve la señal). */
  sync: (opts?: { force?: boolean }) => Promise<SyncReport | null>;
  retryFailed: () => Promise<void>;
  discardFailed: () => Promise<void>;
  pendingForOrder: (orderId: number) => number;
  pendingForItem: (itemId: number) => number;
}

const Ctx = createContext<SyncState | null>(null);

/**
 * Orquesta la cola en la interfaz.
 *
 * Los navegadores móviles suspenden pestañas en segundo plano, así que NO se
 * depende de procesos de fondo. Se sincroniza:
 *   1. al abrir la app (con sesión),
 *   2. al recuperar la conexión (`online`),
 *   3. al volver a primer plano (`visibilitychange`),
 *   4. tras cada operación encolada,
 *   5. cada 30 s mientras la app está abierta (para que venzan los backoff),
 *   6. cuando el usuario toca "Sincronizar".
 */
export function SyncProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  const syncer = useMemo(() => new OutboxSyncer(new ApiOutboxSender(), () => userRef.current), []);

  const live = useLiveQuery(
    () => (userId ? db.outbox.where('userId').equals(userId).sortBy('id') : Promise.resolve([] as OutboxEntry[])),
    [userId],
  );
  const entries = useMemo(() => live ?? [], [live]);

  const sync = useCallback(async (opts?: { force?: boolean }) => {
    if (!userRef.current) return null;
    setSyncing(true);
    if (opts?.force) await outboxDao.makeDueNow(userRef.current);
    try {
      const r = await syncer.drain();
      setLastReport(r);
      setLastSyncAt(Date.now());
      return r;
    } finally {
      setSyncing(false);
    }
  }, [syncer]);

  // Al abrir: lo que quedó "enviando" vuelve a la cola; luego se drena y se purga.
  useEffect(() => {
    if (!userId) return;
    void (async () => {
      await outboxDao.recoverStuck();
      await outboxDao.purgeSent();
      await sync();
    })();
  }, [userId, sync]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void sync({ force: true });
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') void sync();
    }, 30_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [sync]);

  const enqueue = useCallback(
    async (drafts: OutboxDraft[]) => {
      const uid = userRef.current;
      if (!uid) throw new Error('Sin sesión');
      for (const d of drafts) await outboxDao.enqueue(d, uid);
      void sync();
    },
    [sync],
  );

  const retryFailed = useCallback(async () => {
    if (!userRef.current) return;
    await outboxDao.retryFailed(userRef.current);
    void sync();
  }, [sync]);

  const discardFailed = useCallback(async () => {
    if (!userRef.current) return;
    await outboxDao.discardFailed(userRef.current);
  }, []);

  const value = useMemo<SyncState>(() => {
    const open = entries.filter((e) => e.status === 'pendiente' || e.status === 'enviando');
    return {
      online,
      syncing,
      lastReport,
      lastSyncAt,
      openCount: open.length,
      failedCount: entries.filter((e) => e.status === 'fallida').length,
      entries,
      enqueue,
      sync,
      retryFailed,
      discardFailed,
      pendingForOrder: (orderId) => open.filter((e) => e.orderId === orderId).length,
      pendingForItem: (itemId) => open.filter((e) => e.itemId === itemId && itemId > 0).length,
    };
  }, [entries, online, syncing, lastReport, lastSyncAt, enqueue, sync, retryFailed, discardFailed]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync fuera de SyncProvider');
  return v;
}

export function outboxBannerMessage(failed: number, open: number): string {
  if (failed === 0) return `${open} ${open === 1 ? 'operación pendiente por subir' : 'operaciones pendientes por subir'}`;
  const fallidas = `${failed} ${failed === 1 ? 'operación no se pudo enviar' : 'operaciones no se pudieron enviar'}`;
  if (open === 0) return fallidas;
  return `${fallidas} · ${open === 1 ? '1 más espera' : `${open} más esperan`} detrás`;
}
