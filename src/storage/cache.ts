import { db } from './db';

/**
 * Caché de lectura por usuario. Lo descargado (órdenes, catálogos, reportes)
 * queda disponible sin conexión. Se borra al cerrar sesión; la cola de
 * operaciones NO (ver `auth/logout`).
 */
let currentUserId = '';

export function setCacheUser(userId: string) {
  currentUserId = userId;
}

export async function cacheGet<T>(key: string): Promise<{ value: T; updatedAt: number } | null> {
  const row = await db.cache.get(`${currentUserId}:${key}`);
  if (!row) return null;
  return { value: row.value as T, updatedAt: row.updatedAt };
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  await db.cache.put({
    key: `${currentUserId}:${key}`,
    userId: currentUserId,
    value,
    updatedAt: Date.now(),
  });
}

export async function cacheClearAll(): Promise<void> {
  await db.cache.clear();
}

/**
 * Ejecuta `fetcher`; si responde, guarda en caché. Si falla por red, devuelve
 * lo último guardado. Así cada pantalla funciona igual con y sin señal.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  isNetworkError: (e: unknown) => boolean,
): Promise<{ value: T; fromCache: boolean; updatedAt: number }> {
  try {
    const value = await fetcher();
    await cachePut(key, value);
    return { value, fromCache: false, updatedAt: Date.now() };
  } catch (e) {
    if (isNetworkError(e)) {
      const cached = await cacheGet<T>(key);
      if (cached) return { value: cached.value, fromCache: true, updatedAt: cached.updatedAt };
    }
    throw e;
  }
}
