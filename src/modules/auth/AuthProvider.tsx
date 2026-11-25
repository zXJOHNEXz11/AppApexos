import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiException } from '../../services/apiClient';
import { cacheClearAll, setCacheUser } from '../../storage/cache';
import { db } from '../../storage/db';
import { rememberQuickLogin, type QuickLoginUser } from '../../services/webauthn';
import * as auth from './authService';
import type { AppUser } from './user';

type Status = 'unknown' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: Status;
  user: AppUser | null;
  error: string | null;
  busy: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  /**
   * Entra con la huella registrada en este celular y luego exige la selfie: el lector del
   * teléfono acepta cualquier dedo inscrito, así que el rostro prueba QUIÉN entra. La sesión
   * solo se abre si `verifyFace` confirma el rostro del usuario de esa huella.
   */
  loginWithFingerprint: (who: QuickLoginUser, verifyFace: (user: AppUser) => Promise<boolean>) => Promise<boolean>;
  /** Cierra sesión. Las operaciones pendientes NO se borran (ver abajo). */
  logout: () => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<AuthState | null>(null);

/**
 * Sesión (port de `AuthProvider`). Un 401 irrecuperable en cualquier pantalla
 * devuelve al login con "Tu sesión expiró".
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('unknown');
  const [user, setUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.onSessionExpired = () => {
      setUser(null);
      setStatus((s) => {
        if (s === 'authenticated') setError('Tu sesión expiró, vuelve a ingresar');
        return 'unauthenticated';
      });
    };
    void (async () => {
      let u: AppUser | null = null;
      try {
        u = await auth.restoreSession();
      } catch {
        u = null; // ante la duda, al login (nunca quedarse en el splash)
      }
      if (u) {
        setCacheUser(String(u.id));
        void rememberQuickLogin(u).catch(() => undefined);
      }
      setUser(u);
      setStatus(u ? 'authenticated' : 'unauthenticated');
    })();
  }, []);

  const enter = useCallback(async (attempt: () => Promise<AppUser>, failMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      const u = await attempt();
      setCacheUser(String(u.id));
      // Quien ya tenía su huella registrada queda con su botón en el login.
      void rememberQuickLogin(u).catch(() => undefined);
      setUser(u);
      setStatus('authenticated');
      return true;
    } catch (e) {
      setError(e instanceof ApiException || e instanceof Error ? e.message : failMessage);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const login = useCallback(
    (email: string, password: string) => enter(() => auth.login(email, password), 'No fue posible iniciar sesión'),
    [enter],
  );

  const loginWithFingerprint = useCallback(
    (who: QuickLoginUser, verifyFace: (user: AppUser) => Promise<boolean>) =>
      enter(async () => {
        const u = await auth.loginWithFingerprint(who);
        let verified = false;
        try {
          verified = await verifyFace(u);
        } catch (e) {
          await auth.serverLogout();
          throw e;
        }
        if (!verified) {
          // Sin rostro confirmado la sesión recién creada se cierra también en el servidor.
          await auth.serverLogout();
          throw new Error('Ingreso cancelado: falta confirmar tu rostro.');
        }
        return u;
      }, 'No fue posible entrar con tu huella'),
    [enter],
  );

  /**
   * Eliminación controlada al cerrar sesión:
   * - Se borran token, usuario en caché y datos descargados (órdenes, reportes).
   * - La cola y sus fotos SE CONSERVAN, marcadas con el usuario dueño. Solo se
   *   envían cuando ese mismo usuario vuelva a entrar; nadie más las ve ni las
   *   manda. La pantalla de Perfil advierte antes si hay pendientes.
   */
  const logout = useCallback(async () => {
    await auth.serverLogout();
    await cacheClearAll();
    await db.syncLog.clear();
    setCacheUser('');
    setUser(null);
    setError(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ status, user, error, busy, login, loginWithFingerprint, logout, clearError: () => setError(null) }),
    [status, user, error, busy, login, loginWithFingerprint, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}

export function useUser(): AppUser {
  const { user } = useAuth();
  if (!user) throw new Error('Ruta protegida sin usuario');
  return user;
}
