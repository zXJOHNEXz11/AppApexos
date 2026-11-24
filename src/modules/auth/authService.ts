import { supabaseConfigured } from '../../config/env';
import { Api } from '../../config/endpoints';
import { asMap, asStringOrNull } from '../../core/json';
import { api, ApiException } from '../../services/apiClient';
import { SupabaseError, supabaseSignIn } from '../../services/supabaseAuth';
import { forgetQuickLogin, signLoginWithFingerprint, type QuickLoginUser } from '../../services/webauthn';
import { SecretKeys, secureStore } from '../../storage/secureStore';
import { userFromJson, type AppUser } from './user';

/**
 * Autenticación (port de `AuthService`).
 *
 * Primero la cuenta propia de la API; si responde 401/404 ("credenciales
 * inválidas"), Supabase, que es el padrón de la web. Un bloqueo por intentos o
 * un fallo de red NO se tapa probando por otro lado.
 */
export async function login(email: string, password: string): Promise<AppUser> {
  try {
    return await loginWithApi(email, password);
  } catch (e) {
    const rejected = e instanceof ApiException && (e.statusCode === 401 || e.statusCode === 404);
    if (!rejected || !supabaseConfigured()) throw e;
    return loginWithSupabase(email, password, e as ApiException);
  }
}

async function loginWithApi(email: string, password: string): Promise<AppUser> {
  const res = asMap(await api.post(Api.login, { email, password }, { auth: false }));
  const token = asStringOrNull(res.token);
  if (!token) throw new ApiException('El servidor no devolvió un token de sesión');
  await api.saveSession(token, asStringOrNull(res.refresh));
  const user = userFromJson(asMap(res.user), asMap(res.tenant));
  await cacheUser(user);
  return user;
}

/**
 * Ingreso con la huella que la persona registró en Marcar jornada (requiere señal):
 * el servidor entrega un reto de un solo uso, el celular lo firma tras la huella y
 * el servidor responde la MISMA sesión que con correo y clave.
 */
export async function loginWithFingerprint(q: QuickLoginUser): Promise<AppUser> {
  const challenge = asStringOrNull(asMap(await api.post(Api.webauthnChallenge, { tenant_id: q.tenantId, user_id: q.userId }, { auth: false })).challenge);
  if (!challenge) throw new ApiException('El servidor no entregó el reto de ingreso');
  const proof = await signLoginWithFingerprint(q, challenge);
  let res;
  try {
    res = asMap(await api.post(Api.webauthnLogin, { challenge, ...proof }, { auth: false }));
  } catch (e) {
    // La llave fue restablecida por talento humano: se quita el botón de este celular.
    if (e instanceof ApiException && e.statusCode === 401 && e.code === 'HUELLA_NO_REGISTRADA') await forgetQuickLogin(q.userId);
    throw e;
  }
  const token = asStringOrNull(res.token);
  if (!token) throw new ApiException('El servidor no devolvió un token de sesión');
  await api.saveSession(token, asStringOrNull(res.refresh));
  const user = userFromJson(asMap(res.user), asMap(res.tenant));
  await cacheUser(user);
  return user;
}

async function loginWithSupabase(email: string, password: string, fallback: ApiException): Promise<AppUser> {
  let session;
  try {
    session = await supabaseSignIn(email, password);
  } catch (e) {
    if (e instanceof SupabaseError && (e.statusCode === 400 || e.statusCode === 401)) throw fallback;
    if (e instanceof SupabaseError) throw new ApiException(e.message, e.statusCode);
    throw e;
  }
  await api.saveSession(session.accessToken, session.refreshToken, 'supabase');
  try {
    const res = asMap(await api.get(Api.me));
    const user = userFromJson(asMap(res.user), asMap(res.tenant));
    await cacheUser(user);
    return user;
  } catch (e) {
    // Token válido pero la API no reconoce al usuario en ninguna empresa.
    await api.clearSession();
    throw e;
  }
}

/**
 * Sesión guardada + revalidación con `/auth/me`. Sin red se confía en el
 * usuario en caché para permitir trabajar offline.
 */
export async function restoreSession(): Promise<AppUser | null> {
  await api.loadSession();
  if (!api.hasToken) return null;
  try {
    const res = asMap(await api.get(Api.me));
    const user = userFromJson(asMap(res.user), asMap(res.tenant));
    await cacheUser(user);
    return user;
  } catch (e) {
    if (e instanceof ApiException && (e.isAuth || e.statusCode === 403)) {
      await api.clearSession();
      return null;
    }
    return cachedUser();
  }
}

export async function serverLogout(): Promise<void> {
  try {
    await api.post(Api.logout);
  } catch {
    /* se cierra localmente aunque el servidor no responda */
  }
  await api.clearSession();
}

async function cacheUser(user: AppUser) {
  await secureStore.write(SecretKeys.user, JSON.stringify(user));
}

async function cachedUser(): Promise<AppUser | null> {
  const raw = await secureStore.read(SecretKeys.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AppUser;
  } catch {
    return null;
  }
}
