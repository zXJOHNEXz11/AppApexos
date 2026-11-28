/**
 * Versión nueva de la app (Service Worker en modo "prompt").
 *
 * - Al ABRIR: si hay versión nueva en los primeros segundos y la persona aún no ha tocado
 *   nada, se aplica sola (recarga segura: no hay nada a medio hacer).
 * - Con la app abierta: se revisa cada 15 minutos y al volver a la app. Si hay versión
 *   nueva, NO se recarga sola (abrir la cámara saca de la app y al volver se perdería la
 *   selfie a medio tomar): se muestra el aviso "Nueva versión disponible · Actualizar".
 */
type Listener = () => void;

let ready = false;
let apply: (() => Promise<void>) | null = null;
const listeners = new Set<Listener>();

export const updateStore = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: () => ready,
  /** Activa la versión nueva y recarga. */
  async applyNow() {
    if (apply) await apply();
    else window.location.reload();
  },
};

function markReady(applyFn: () => Promise<void>) {
  apply = applyFn;
  ready = true;
  listeners.forEach((fn) => fn());
}

const STARTUP_WINDOW_MS = 8_000;
const CHECK_EVERY_MS = 15 * 60_000;

export async function startAppUpdates(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const startedAt = Date.now();
  let touched = false;
  const markTouched = () => { touched = true; };
  window.addEventListener('pointerdown', markTouched, { once: true, capture: true });
  window.addEventListener('keydown', markTouched, { once: true, capture: true });

  const { registerSW } = await import('virtual:pwa-register');
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const applyFn = () => updateSW(true);
      // Recién abierta y sin tocar nada: se actualiza sola.
      if (!touched && Date.now() - startedAt < STARTUP_WINDOW_MS) {
        void applyFn();
        return;
      }
      markReady(applyFn);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => undefined);
      };
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
