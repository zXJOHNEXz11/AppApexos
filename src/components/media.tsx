import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { compressEvidence, compressSelfie, formatKb, type PreparedPhoto } from '../services/media';
import { useFeedback } from './feedback';
import { Icon } from './Icon';
import { Spinner } from './ui';

/**
 * Captura de fotos con `<input type="file" capture>`.
 *
 * Es lo más compatible entre Chrome Android y Safari iPhone: abre la cámara
 * nativa sin depender de getUserMedia (que en iOS falla dentro de PWAs
 * instaladas en algunas versiones). Si el usuario negó la cámara, el sistema
 * ofrece la galería; si cancela, no pasa nada.
 */
export function PhotoButton({
  purpose,
  selfie = false,
  label,
  retakeLabel,
  value,
  onChange,
  allowGallery = true,
  tone = 'teal',
}: {
  purpose: string;
  selfie?: boolean;
  label: string;
  retakeLabel?: string;
  value: PreparedPhoto | null;
  onChange: (p: PreparedPhoto | null) => void;
  allowGallery?: boolean;
  tone?: 'teal' | 'red';
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();

  const handle = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== '') {
      toast('El archivo debe ser una imagen', 'bad');
      return;
    }
    setBusy(true);
    try {
      onChange(selfie ? await compressSelfie(file) : await compressEvidence(file, purpose));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No fue posible tomar la foto', 'bad');
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
    }
  };

  const color = value ? 'border-teal-solid text-teal' : tone === 'red' ? 'border-bad/60 text-bad' : 'border-line text-teal';

  return (
    <div className="flex items-center gap-3">
      {value && (
        <img src={value.previewUrl} alt="Vista previa" className="h-[52px] w-[52px] shrink-0 rounded-lg border border-line object-cover" />
      )}
      <div className="flex min-w-0 flex-1 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          aria-label={value ? (retakeLabel ?? `${label}: foto lista`) : label}
          className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border px-3 text-[14px] font-semibold active:opacity-80 ${color}`}
        >
          {busy ? <Spinner size={18} /> : <Icon name={value ? 'refresh' : 'camera'} size={18} />}
          <span className="truncate">{value ? (retakeLabel ?? `Foto lista · ${formatKb(value.size)}`) : label}</span>
        </button>
        {allowGallery && !selfie && (
          <button
            type="button"
            aria-label="Elegir de la galería"
            disabled={busy}
            onClick={() => galleryRef.current?.click()}
            className="flex min-h-12 w-12 items-center justify-center rounded-[14px] border border-line text-muted active:opacity-80"
          >
            <Icon name="image" size={18} />
          </button>
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture={selfie ? 'user' : 'environment'} hidden onChange={(e) => handle(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => handle(e.target.files?.[0])} />
    </div>
  );
}

/** Recuadro de firma con el dedo (equivalente a `signature`). */
export function SignaturePad({ onChange, canvasRef }: {
  onChange: (hasInk: boolean) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
  }, [canvasRef]);

  const point = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange(true);
    }
  };
  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    onChange(false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className={`block h-[190px] w-full touch-none rounded-[14px] border-2 bg-white ${hasInk ? 'border-teal-solid' : 'border-line'}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Recuadro de firma"
      />
      <button type="button" disabled={!hasInk} onClick={clear} className="mt-1 flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-teal disabled:opacity-40">
        <Icon name="restore" size={16} /> Borrar firma
      </button>
    </div>
  );
}
