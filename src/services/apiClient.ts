import { env, IDEMPOTENCY_HEADER, TIMEOUT_MS } from '../config/env';
import { Api } from '../config/endpoints';
import { asMap, asStringOrNull } from '../core/json';
import { SecretKeys, secureStore } from '../storage/secureStore';
import { supabaseRefresh } from './supabaseAuth';

/** Error de la API (port de `ApiException`). */
export class ApiException extends Error {
  readonly statusCode: number | null;
  readonly code: string | null;

  constructor(message: string, statusCode: number | null = null, code: string | null = null) {
    super(message);
    this.name = 'ApiException';
    this.statusCode = statusCode;
    this.code = code;
  }

  get isAuth() {
    return this.statusCode === 401;
  }
  /** La solicitud cambió de estado en el servidor: recargar, no reintentar. */
  get isConflict() {
    return this.statusCode === 409;
  }
  /** Red o servidor: vale la pena reintentar. Un 4xx no. */
  get isRetryable() {
    return this.statusCode === null || this.statusCode === 408 || this.statusCode >= 500;
  }
  /** No hubo respuesta del servidor (sin señal, timeout, CORS). */
  get isNetwork() {
    return this.statusCode === null;
  }
}

export const isNetworkError = (e: unknown) => e instanceof ApiException && e.isNetwork;

/** Para lecturas: sin red, timeout o 5xx (servidor/proxy caído) → usar la copia local. */
export const canUseCache = (e: unknown) => e instanceof ApiException && e.isRetryable;

function defaultMessage(status: number): string {
  if (status >= 500) return 'Error del servidor, intenta de nuevo';
  switch (status) {
    case 400: return 'Datos inválidos';
    case 401: return 'Sesión expirada';
    case 403: return 'No tienes permiso para esta acción';
    case 404: return 'No encontrado';
    case 409: return 'El servicio cambió de estado, actualiza la lista';
    case 413: return 'La foto pesa demasiado';
    case 422: return 'Datos incompletos o inválidos';
    case 429: return 'Demasiados intentos, espera un momento';
    default: return `Error inesperado (${status})`;
  }
}

type Provider = 'api' | 'supabase';

interface SendOptions {
  body?: unknown;
  query?: Record<string, string | undefined>;
  auth?: boolean;
  idempotencyKey?: string;
  timeoutMs?: number;
  allowRetry?: boolean;
}

/**
 * Cliente HTTP único contra la API de APEXOS (port de `ApiClient`).
 *
 * Adjunta el Bearer, y ante un 401 renueva el token UNA vez (compartiendo un
 * solo refresh entre peticiones concurrentes) y repite. Si el refresh falla,
 * limpia la sesión y avisa a la app para volver al login.
 */
class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private provider: Provider = 'api';
  private refreshing: Promise<boolean> | null = null;
  onSessionExpired: (() => void) | null = null;

  get hasToken() {
    return this.token !== null;
  }

  async loadSession() {
    this.token = await secureStore.read(SecretKeys.token);
    this.refreshToken = await secureStore.read(SecretKeys.refresh);
    this.provider = ((await secureStore.read(SecretKeys.provider)) as Provider) || 'api';
  }

  async saveSession(token: string, refresh: string | null, provider: Provider = 'api') {
    this.token = token;
    this.refreshToken = refresh;
    this.provider = provider;
    await secureStore.write(SecretKeys.provider, provider);
    await secureStore.write(SecretKeys.token, token);
    if (refresh) await secureStore.write(SecretKeys.refresh, refresh);
  }

  async clearSession() {
    this.token = null;
    this.refreshToken = null;
    this.provider = 'api';
    for (const k of Object.values(SecretKeys)) await secureStore.delete(k);
  }

  get<T = unknown>(path: string, query?: SendOptions['query']) {
    return this.send<T>('GET', path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, opts: Omit<SendOptions, 'body'> = {}) {
    return this.send<T>('POST', path, { ...opts, body });
  }
  patch<T = unknown>(path: string, body?: unknown, opts: Omit<SendOptions, 'body'> = {}) {
    return this.send<T>('PATCH', path, { ...opts, body });
  }

  private url(path: string, query?: SendOptions['query']) {
    const base = env.apiBaseUrl.replace(/\/$/, '');
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') qs.set(k, v);
    const q = qs.toString();
    return `${base}${path}${q ? `?${q}` : ''}`;
  }

  async send<T = unknown>(method: string, path: string, opts: SendOptions = {}): Promise<T> {
    const { body, query, auth = true, idempotencyKey, timeoutMs = TIMEOUT_MS, allowRetry = true } = opts;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    if (idempotencyKey) headers[IDEMPOTENCY_HEADER] = idempotencyKey;

    const response = await this.execute(this.url(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }, timeoutMs);

    if (response.status === 401 && auth && allowRetry) {
      if (await this.tryRefresh()) {
        return this.send<T>(method, path, { ...opts, allowRetry: false });
      }
      await this.clearSession();
      this.onSessionExpired?.();
    }
    return this.decode<T>(response);
  }

  private async execute(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiException('Sin conexión con el servidor');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw new ApiException('El servidor tardó demasiado en responder');
      }
      // fetch no distingue "sin señal" de "CORS bloqueado": ambos son TypeError.
      throw new ApiException('Sin conexión con el servidor');
    } finally {
      clearTimeout(timer);
    }
  }

  private tryRefresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const refresh = this.refreshToken;
    if (!refresh) return false;
    try {
      if (this.provider === 'supabase') {
        const s = await supabaseRefresh(refresh);
        await this.saveSession(s.accessToken, s.refreshToken ?? refresh, 'supabase');
        return true;
      }
      const res = asMap(
        await this.send('POST', Api.refresh, { body: { refresh }, auth: false, allowRetry: false }),
      );
      const token = asStringOrNull(res.token);
      if (!token) return false;
      await this.saveSession(token, asStringOrNull(res.refresh) ?? refresh);
      return true;
    } catch {
      return false;
    }
  }

  private async decode<T>(response: Response): Promise<T> {
    let body: unknown = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (response.ok) return body as T;
    const map = asMap(body);
    const message =
      asStringOrNull(map.message) ?? asStringOrNull(map.error) ?? defaultMessage(response.status);
    throw new ApiException(message, response.status, asStringOrNull(map.code));
  }
}

export const api = new ApiClient();
