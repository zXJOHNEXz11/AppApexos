import { env, supabaseConfigured, TIMEOUT_MS } from '../config/env';
import { SUPABASE_TOKEN_PATH } from '../config/endpoints';
import { asMap, asString, asStringOrNull } from '../core/json';

/**
 * Inicio de sesión contra Supabase Auth (port de `SupabaseAuth`).
 * No usa el cliente de la API: aquí va la cabecera `apikey` del proyecto.
 * La clave publicable es pública por diseño; lo que protege es RLS.
 */
export interface SupabaseSession {
  accessToken: string;
  refreshToken: string | null;
}

class SupabaseError extends Error {
  readonly statusCode: number | null;
  constructor(message: string, statusCode: number | null) {
    super(message);
    this.statusCode = statusCode;
  }
}
export { SupabaseError };

function translate(map: Record<string, unknown>): string {
  const raw = asString(map.msg ?? map.error_description ?? map.error ?? map.message);
  const low = raw.toLowerCase();
  if (low.includes('invalid login credentials')) return 'No fue posible iniciar sesion con esas credenciales.';
  if (low.includes('email not confirmed')) return 'La cuenta existe pero el correo no está confirmado.';
  return raw || 'No fue posible validar la sesión.';
}

async function token(query: string, body: Record<string, unknown>): Promise<SupabaseSession> {
  if (!supabaseConfigured()) throw new SupabaseError('Supabase no está configurado en esta app', null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}${SUPABASE_TOKEN_PATH}?${query}`, {
      method: 'POST',
      headers: { apikey: env.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new SupabaseError('Sin conexión con el servidor', null);
  } finally {
    clearTimeout(timer);
  }
  let map: Record<string, unknown> = {};
  try {
    map = asMap(await res.json());
  } catch {
    /* cuerpo vacío */
  }
  if (res.status >= 400) throw new SupabaseError(translate(map), res.status);
  const access = asStringOrNull(map.access_token);
  if (!access) throw new SupabaseError('Supabase no devolvió un token de sesión', res.status);
  return { accessToken: access, refreshToken: asStringOrNull(map.refresh_token) };
}

export const supabaseSignIn = (email: string, password: string) =>
  token('grant_type=password', { email: email.trim(), password });

export const supabaseRefresh = (refreshToken: string) =>
  token('grant_type=refresh_token', { refresh_token: refreshToken });
