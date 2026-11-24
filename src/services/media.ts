import { MAX_EVIDENCE_BYTES } from '../config/env';
import { newClientUuid } from '../core/ids';
import { db, type StoredFile } from '../storage/db';

/**
 * Fotos y evidencias en el navegador (port de `photo_capture.dart`).
 *
 * - Evidencia: lado mayor ≤ 1920 px, JPEG calidad 0.85 → 0.70 → 0.55 → 0.40
 *   hasta quedar ≤ 2 MB (tope de la API). Sin EXIF: el canvas lo descarta.
 * - Selfie: lado menor ≈ 360 px, calidad 0.60, tope 300 KB (como la app). La
 *   API web acepta hasta 2 MB, pero se mantiene la selfie liviana.
 */
export interface PreparedPhoto {
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  previewUrl: string;
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Respeta la orientación EXIF del teléfono (fotos de iPhone de lado).
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* Safari antiguo: se intenta con <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la foto'))), mime, quality),
  );
}

function draw(src: ImageBitmap | HTMLImageElement, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

export async function compressEvidence(file: Blob, purpose: string): Promise<PreparedPhoto> {
  const src = await loadBitmap(file);
  const scale = Math.min(1, 1920 / Math.max(src.width, src.height));
  const canvas = draw(src, scale);
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await toBlob(canvas, 'image/jpeg', q);
    if (blob.size <= MAX_EVIDENCE_BYTES) return prepared(blob, 'image/jpeg', `${purpose}_${Date.now()}.jpg`);
  }
  throw new Error('No fue posible comprimir la evidencia por debajo de 2 MB');
}

export async function compressSelfie(file: Blob): Promise<PreparedPhoto> {
  const src = await loadBitmap(file);
  const scale = Math.min(1, 360 / Math.min(src.width, src.height));
  const canvas = draw(src, scale);
  const blob = await toBlob(canvas, 'image/jpeg', 0.6);
  if (blob.size > 300 * 1024) throw new Error('La foto quedó demasiado pesada. Intenta de nuevo.');
  return prepared(blob, 'image/jpeg', `selfie_${Date.now()}.jpg`);
}

/** Firma del cliente: PNG sobre fondo blanco. */
export async function signatureFromCanvas(canvas: HTMLCanvasElement): Promise<PreparedPhoto> {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const blob = await toBlob(out, 'image/png');
  if (blob.size > MAX_EVIDENCE_BYTES) throw new Error('La evidencia supera el límite de 2 MB');
  return prepared(blob, 'image/png', `firma_cliente_${Date.now()}.png`);
}

function prepared(blob: Blob, mime: string, name: string): PreparedPhoto {
  return { blob, mime, name, size: blob.size, previewUrl: URL.createObjectURL(blob) };
}

/** Guarda la foto en IndexedDB. La cola guarda solo el id. */
export async function storePhoto(p: PreparedPhoto, userId: string): Promise<StoredFile> {
  const file: StoredFile = {
    id: newClientUuid(),
    blob: p.blob,
    mime: p.mime,
    name: p.name,
    size: p.size,
    userId,
    createdAt: Date.now(),
  };
  await db.files.put(file);
  return file;
}

export const formatKb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
