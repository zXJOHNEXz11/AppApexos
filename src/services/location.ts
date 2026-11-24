import type { GpsFix } from '../sync/outboxRequests';

/**
 * Ubicación (port de `location_service.dart`).
 * 1. Lectura fresca con timeout de 8 s → `fresh`.
 * 2. Si falla, última posición conocida ≤ 10 min → `stale`.
 * 3. Si no, el motivo (permiso, apagada, sin señal). Nunca bloquea el trabajo.
 */
export type GpsOutcome = 'fresh' | 'stale' | 'serviceDisabled' | 'permissionDenied' | 'permissionBlocked' | 'noSignal';

export interface GpsReading {
  outcome: GpsOutcome;
  fix: GpsFix | null;
}

export const GPS_MESSAGES: Record<GpsOutcome, string> = {
  fresh: 'Ubicación validada para esta jornada.',
  stale: 'Sin señal nueva: se usó tu última ubicación conocida. La marcación quedará señalada.',
  serviceDisabled: 'La ubicación del teléfono está apagada. Actívala en los ajustes para registrar dónde marcas.',
  permissionDenied: 'Concede el permiso de ubicación para registrar dónde marcas.',
  permissionBlocked:
    'El permiso de ubicación está bloqueado. Habilítalo en los ajustes del navegador (candado junto a la dirección).',
  noSignal: 'Sin señal de GPS. Puedes marcar igual y la marcación quedará señalada.',
};

/** Valor de `metadata.gps_quality` (mismos strings que la app). */
export function gpsQuality(r: GpsReading | null): string {
  if (!r) return 'sin_gps';
  switch (r.outcome) {
    case 'fresh': return 'gps_confirmado';
    case 'stale': return 'gps_aproximado';
    case 'serviceDisabled': return 'sin_gps_ubicacion_apagada';
    case 'permissionDenied':
    case 'permissionBlocked': return 'sin_gps_permiso_negado';
    default: return 'sin_gps_sin_senal';
  }
}

function position(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, opts));
}

const toFix = (p: GeolocationPosition): GpsFix => ({
  latitude: p.coords.latitude,
  longitude: p.coords.longitude,
  accuracyMeters: p.coords.accuracy,
});

export async function readLocation(): Promise<GpsReading> {
  if (!('geolocation' in navigator)) return { outcome: 'serviceDisabled', fix: null };
  try {
    const p = await position({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
    return { outcome: 'fresh', fix: toFix(p) };
  } catch (e) {
    const err = e as GeolocationPositionError;
    if (err?.code === 1) {
      // El navegador no distingue "negado ahora" de "bloqueado": se consulta.
      let blocked = false;
      try {
        const st = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
        blocked = st?.state === 'denied';
      } catch {
        /* Safari sin Permissions API */
      }
      return { outcome: blocked ? 'permissionBlocked' : 'permissionDenied', fix: null };
    }
    try {
      const last = await position({ enableHighAccuracy: false, timeout: 3000, maximumAge: 600_000 });
      return { outcome: 'stale', fix: toFix(last) };
    } catch {
      return { outcome: err?.code === 2 ? 'serviceDisabled' : 'noSignal', fix: null };
    }
  }
}

/** Para los flujos de servicio: solo una lectura fresca, si no, null. */
export async function currentFix(): Promise<GpsFix | null> {
  const r = await readLocation();
  return r.outcome === 'fresh' ? r.fix : null;
}
