import type { Human } from '@vladmandic/human';

/**
 * Reconocimiento facial en el celular (maestro de rostros).
 *
 * Varios empleados marcan en el MISMO celular; el lector de huella no dice de quién es
 * la huella. La selfie de cada marcación se compara aquí, AL INSTANTE y SIN SEÑAL, con
 * el rostro registrado del empleado conectado. El servidor vuelve a comparar con el mismo
 * modelo (apps/api/src/modules/hr/face-identity.js) y la MISMA fórmula de similitud.
 *
 * Human (MIT) se carga solo cuando hace falta (chunk aparte). Sus modelos se sirven desde
 * /models/human/ y el Service Worker los guarda en caché.
 */

export const FACE_MODEL = 'human-3.3.6/faceres-1024';
export const DEFAULT_MATCH_THRESHOLD = 0.55;

/**
 * Mínimo de coincidencia que usa el CELULAR para dejar marcar. Más tolerante que el del
 * servidor (0.55) porque muchos marcan con cámaras rayadas o de baja calidad: medido con
 * rostros reales, la misma persona con la foto borrosa da ~0.55 y otra persona 0.32–0.38.
 * 0.45 deja pasar la foto borrosa y sigue bloqueando a otra persona. Se puede ajustar con
 * VITE_FACE_MATCH_THRESHOLD sin cambiar código.
 */
export const APP_MATCH_THRESHOLD = (() => {
  const v = Number(import.meta.env.VITE_FACE_MATCH_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.45;
})();

/** El mínimo efectivo: el del servidor, pero nunca más estricto que el del celular. */
export const effectiveThreshold = (serverThreshold: number) => Math.min(serverThreshold || DEFAULT_MATCH_THRESHOLD, APP_MATCH_THRESHOLD);

export type FaceStatus = 'coincide' | 'no_coincide' | 'sin_rostro' | 'varios_rostros' | 'no_disponible';

export interface FaceCheck {
  status: FaceStatus;
  similarity: number | null;
  antispoof: number | null;
  liveness: number | null;
  threshold: number;
  model: string;
  /** Por qué no se pudo comparar (solo en no_disponible). */
  reason?: string;
}

interface DetectedFace {
  embedding: number[];
  real: number | null;
  live: number | null;
}

/** Similitud coseno. El servidor usa EXACTAMENTE esta fórmula. */
export function similarity(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const round = (n: number | null | undefined) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : null);

let humanPromise: Promise<Human> | null = null;

function faceConfig(backend: string) {
  return {
    backend,
    modelBasePath: '/models/human/',
    debug: false,
    async: true,
    warmup: 'none',
    cacheSensitivity: 0,
    filter: { enabled: false },
    face: {
      enabled: true,
      // 0.2 es el valor por defecto de la librería: detecta rostros en fotos borrosas o con poca luz.
      detector: { enabled: true, rotation: false, maxDetected: 3, minConfidence: 0.2 },
      mesh: { enabled: true },
      iris: { enabled: false },
      description: { enabled: true },
      emotion: { enabled: false },
      antispoof: { enabled: true },
      liveness: { enabled: true },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
  };
}

async function loadHuman(): Promise<Human> {
  const { Human: HumanClass } = await import('@vladmandic/human');
  // WebGL en todos los celulares actuales; si no está, CPU (más lento, pero funciona).
  for (const backend of ['webgl', 'cpu']) {
    try {
      const human = new HumanClass(faceConfig(backend) as never);
      await human.load();
      return human;
    } catch {
      /* se intenta el siguiente backend */
    }
  }
  throw new Error('No fue posible cargar el reconocimiento facial en este celular');
}

export function getHuman(): Promise<Human> {
  humanPromise ??= loadHuman().catch((e) => {
    humanPromise = null;
    throw e;
  });
  return humanPromise;
}

/** Precarga el modelo (al abrir Marcar jornada) para que la marcación sea rápida. */
export function preloadFaceModel(): void {
  void getHuman().catch(() => undefined);
}

async function toCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas;
}

export async function analyzePhoto(blob: Blob): Promise<DetectedFace[]> {
  const human = await getHuman();
  const result = await human.detect(await toCanvas(blob));
  return (result.face ?? []).map((f) => ({
    embedding: Array.from(f.embedding ?? []),
    real: typeof f.real === 'number' ? f.real : null,
    live: typeof f.live === 'number' ? f.live : null,
  }));
}

/** Validación local de la foto de registro: exactamente un rostro legible. */
export async function checkEnrollmentPhoto(blob: Blob): Promise<{ ok: true; antispoof: number | null; liveness: number | null } | { ok: false; message: string }> {
  let faces: DetectedFace[];
  try {
    faces = await analyzePhoto(blob);
  } catch {
    // Sin modelo en el celular, el servidor valida igual al registrar.
    return { ok: true, antispoof: null, liveness: null };
  }
  if (faces.length === 0) return { ok: false, message: 'No se detectó un rostro. Toma la foto de frente y con buena luz.' };
  if (faces.length > 1) return { ok: false, message: 'Hay más de un rostro en la foto. Debe aparecer solo la persona que se registra.' };
  if (!faces[0].embedding.length) return { ok: false, message: 'No se pudo leer el rostro. Repite la foto.' };
  return { ok: true, antispoof: round(faces[0].real), liveness: round(faces[0].live) };
}

/** Compara la selfie con el rostro registrado. Nunca lanza. */
export async function compareSelfie(enrolled: number[], selfie: Blob, threshold = DEFAULT_MATCH_THRESHOLD): Promise<FaceCheck> {
  const base = { threshold, model: FACE_MODEL };
  let faces: DetectedFace[];
  try {
    faces = await analyzePhoto(selfie);
  } catch {
    // Un segundo intento con el modelo recargado (p. ej. el WebGL del teléfono se reinició).
    try {
      humanPromise = null;
      faces = await analyzePhoto(selfie);
    } catch (e) {
      return { ...base, status: 'no_disponible', similarity: null, antispoof: null, liveness: null, reason: e instanceof Error ? e.message : String(e) };
    }
  }
  // Una cara sin patrón legible no se puede comparar: se trata como "sin rostro".
  faces = faces.filter((f) => f.embedding.length > 0);
  if (faces.length === 0) return { ...base, status: 'sin_rostro', similarity: null, antispoof: null, liveness: null };
  if (faces.length > 1) return { ...base, status: 'varios_rostros', similarity: null, antispoof: null, liveness: null };
  const f = faces[0];
  const score = similarity(enrolled, f.embedding);
  return {
    ...base,
    status: score >= threshold ? 'coincide' : 'no_coincide',
    similarity: round(score),
    antispoof: round(f.real),
    liveness: round(f.live),
  };
}

export const FACE_MESSAGES: Record<Exclude<FaceStatus, 'coincide' | 'no_disponible'>, string> = {
  no_coincide: 'La selfie no coincide con tu foto registrada. Limpia la cámara, busca buena luz y repítela: debe ser la persona de esta sesión.',
  sin_rostro: 'No se ve bien tu rostro en la selfie. Limpia la cámara, busca buena luz y tómala de frente, con la cara completa.',
  varios_rostros: 'Hay más de una persona en la selfie. Debe aparecer solo quien marca.',
};
