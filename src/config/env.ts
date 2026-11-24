/**
 * Configuración por ambiente.
 *
 * Igual que en la app Flutter (`api_config.dart` / `supabase_config.dart`), la
 * API y Supabase tienen que apuntar al MISMO ambiente: cruzarlos deja la
 * autenticación en un lado y los datos en el otro.
 *
 * - `VITE_API_BASE_URL` por defecto es `/api/v1` (mismo origen). El servidor
 *   que publica la app (Vite en desarrollo, Netlify/Vercel/Nginx en producción)
 *   reenvía `/api/*` a Railway. Así el navegador no necesita CORS: la API de
 *   producción solo acepta los orígenes de `ALLOWED_ORIGINS`.
 * - Si el backend agrega el dominio de esta app a `ALLOWED_ORIGINS`, se puede
 *   apuntar directo: `VITE_API_BASE_URL=https://.../api/v1`.
 */
export const env = {
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api/v1',
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || '',
  /** Solo informativo: se muestra en Ajustes para saber contra qué se trabaja. */
  environment: (import.meta.env.VITE_APEXOS_ENV as string | undefined) || 'desconocido',
  /** Permite abrir la app en escritorio (solo para desarrollo y pruebas). */
  allowDesktop: import.meta.env.VITE_ALLOW_DESKTOP === 'true',
} as const;

export const supabaseConfigured = () => env.supabaseUrl !== '' && env.supabaseKey !== '';

/** Mismos tiempos que `ApiConfig` en Flutter. */
export const TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 180_000;

/** Tope de `evidenceAuthorizationSchema` en la API: 2 MB. */
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Cabecera que la API todavía no lee, pero que se manda igual (ver Flutter). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
