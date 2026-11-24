import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/* ---------------- Toasts (SnackBar) ---------------- */

type Tone = 'ok' | 'bad' | 'warn' | 'info';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

interface DialogOpts {
  title: string;
  message?: string;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  /** Si se pasa, el diálogo pide un texto y lo exige no vacío. */
  input?: { label: string; placeholder?: string };
}

interface FeedbackApi {
  toast: (text: string, tone?: Tone) => void;
  confirm: (o: DialogOpts) => Promise<boolean>;
  prompt: (o: DialogOpts) => Promise<string | null>;
}

const Ctx = createContext<FeedbackApi | null>(null);

const TONE_BG: Record<Tone, string> = {
  ok: 'bg-teal-solid',
  bad: 'bg-bad',
  warn: 'bg-warn text-on-primary',
  info: 'bg-surface-high',
};

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(DialogOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [text, setText] = useState('');
  const seq = useRef(0);

  const toast = useCallback((t: string, tone: Tone = 'info') => {
    const id = ++seq.current;
    setToasts((xs) => [...xs.slice(-2), { id, text: t, tone }]);
    window.setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);

  const open = useCallback(
    (o: DialogOpts) =>
      new Promise<string | null>((resolve) => {
        setText('');
        setDialog({ ...o, resolve });
      }),
    [],
  );

  const api = useMemo<FeedbackApi>(
    () => ({
      toast,
      confirm: async (o) => (await open(o)) !== null,
      prompt: (o) => open(o),
    }),
    [toast, open],
  );

  const close = (v: string | null) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4" style={{ bottom: 'calc(var(--nav-h) + var(--safe-bottom) + 12px)' }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${TONE_BG[t.tone]}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5" style={{ marginBottom: 'var(--safe-bottom)' }}>
            <h3 className="text-lg font-bold">{dialog.title}</h3>
            {dialog.message && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{dialog.message}</p>}
            {dialog.input && (
              <label className="mt-4 block">
                <span className="mb-1.5 block text-[13px] text-muted">{dialog.input.label}</span>
                <textarea autoFocus rows={3} className="field resize-none" placeholder={dialog.input.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="min-h-11 rounded-xl px-4 font-semibold text-muted" onClick={() => close(null)}>
                {dialog.cancel ?? 'Cancelar'}
              </button>
              <button
                type="button"
                disabled={!!dialog.input && text.trim() === ''}
                className={`min-h-11 rounded-xl px-4 font-bold disabled:opacity-40 ${dialog.danger ? 'text-bad' : 'text-teal'}`}
                onClick={() => close(dialog.input ? text.trim() : 'ok')}
              >
                {dialog.confirm ?? 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback fuera de FeedbackProvider');
  return v;
}

/* ---------------- Hoja inferior ---------------- */

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-4 pt-3"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-line" />
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[17px] font-extrabold">{title}</h3>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="flex h-10 w-10 items-center justify-center text-muted">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
