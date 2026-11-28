import { useState, useSyncExternalStore } from 'react';
import { updateStore } from '../core/appUpdate';

/** Aviso fijo cuando hay una versión nueva lista: la persona decide cuándo actualizar. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot, () => false);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 12px)' }} role="status">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-teal-solid/50 bg-surface p-3 shadow-lg">
        <p className="flex-1 text-[13.5px]">
          <b>Nueva versión disponible.</b> <span className="text-muted">Actualiza cuando termines lo que estás haciendo.</span>
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void updateStore.applyNow();
          }}
          className="min-h-10 rounded-xl bg-teal-solid px-3.5 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
    </div>
  );
}
