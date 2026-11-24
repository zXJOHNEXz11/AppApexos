import { db } from './db';

/**
 * Almacén de secretos (equivalente web de `flutter_secure_storage`).
 *
 * El navegador no tiene Keystore. Lo más cercano: una llave AES-GCM de
 * WebCrypto creada como NO EXTRAÍBLE y guardada en IndexedDB. El token, el
 * refresh y el usuario se guardan cifrados con ella, así que copiar los
 * archivos de IndexedDB del teléfono no entrega los valores en claro.
 *
 * Límite honesto: no protege contra código que corra dentro de esta misma
 * página (XSS). Por eso la app no usa `dangerouslySetInnerHTML` ni carga
 * scripts de terceros, y la CSP de producción lo restringe.
 */
const KEY_ROW = '__aes_key__';
let keyPromise: Promise<CryptoKey | null> | null = null;

function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

async function getKey(): Promise<CryptoKey | null> {
  if (!cryptoAvailable()) return null;
  keyPromise ??= (async () => {
    const row = await db.secrets.get(KEY_ROW);
    if (row?.value instanceof CryptoKey) return row.value;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await db.secrets.put({ key: KEY_ROW, value: key });
    return key;
  })().catch(() => null);
  return keyPromise;
}

interface Sealed {
  iv: Uint8Array;
  data: ArrayBuffer;
}

export const secureStore = {
  async read(key: string): Promise<string | null> {
    try {
      const row = await db.secrets.get(key);
      if (!row) return null;
      const v = row.value as Sealed | string;
      if (typeof v === 'string') return v; // contexto sin WebCrypto (dev en http)
      const k = await getKey();
      if (!k) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv as BufferSource }, k, v.data);
      return new TextDecoder().decode(plain);
    } catch {
      // Llave corrupta o perdida: mejor volver al login que tumbar la app.
      return null;
    }
  },

  async write(key: string, value: string): Promise<void> {
    try {
      const k = await getKey();
      if (!k) {
        await db.secrets.put({ key, value });
        return;
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        k,
        new TextEncoder().encode(value),
      );
      await db.secrets.put({ key, value: { iv, data } satisfies Sealed });
    } catch {
      /* sin almacén no se guarda la sesión: tocará volver a ingresar */
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await db.secrets.delete(key);
    } catch {
      /* cerrar sesión no puede fallar */
    }
  },
};

export const SecretKeys = {
  token: 'apexos_token',
  refresh: 'apexos_refresh',
  user: 'apexos_user',
  provider: 'apexos_auth_provider',
} as const;
