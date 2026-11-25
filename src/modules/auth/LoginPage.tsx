import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { GradientTile, PrimaryButton, Spinner } from '../../components/ui';
import { platformAuthenticatorAvailable, quickLoginUsers, type QuickLoginUser } from '../../services/webauthn';
import { useAuth } from './AuthProvider';
import { useFaceLogin } from './FaceLoginSheet';

/** Inicio de sesión (port de `login_screen.dart`). */
export function LoginPage() {
  const { login, loginWithFingerprint, busy, error, clearError } = useAuth();
  const { toast } = useFeedback();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  // Personas que registraron su huella en ESTE celular (en Marcar jornada).
  const [quick, setQuick] = useState<QuickLoginUser[]>([]);
  const [entering, setEntering] = useState<number | null>(null);
  // Huella + rostro: la selfie confirma QUIÉN entra (dos personas pueden compartir celular).
  const { verifyFace, sheet: faceSheet } = useFaceLogin();

  const loadQuick = useCallback(async () => {
    try {
      setQuick((await platformAuthenticatorAvailable()) ? await quickLoginUsers() : []);
    } catch {
      setQuick([]);
    }
  }, []);

  useEffect(() => {
    void loadQuick();
  }, [loadQuick]);

  const enterWithFingerprint = async (who: QuickLoginUser) => {
    setEntering(who.userId);
    const ok = await loginWithFingerprint(who, verifyFace);
    setEntering(null);
    if (!ok) void loadQuick(); // si la llave fue restablecida, su botón desaparece
  };

  // Un "Tu sesión expiró" pendiente se muestra una sola vez.
  useEffect(() => {
    if (error) {
      toast(error, 'bad');
      clearError();
    }
  }, [error, toast, clearError]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    const next: typeof errors = {};
    if (!em) next.email = 'Ingresa tu correo';
    else if (!em.includes('@')) next.email = 'Correo inválido';
    if (!password) next.password = 'Ingresa tu contraseña';
    setErrors(next);
    if (Object.keys(next).length) return;
    await login(em, password);
  };

  return (
    <div className="page-bg safe-top flex min-h-full items-center justify-center px-6 py-8">
      <form onSubmit={submit} className="w-full max-w-[420px]" noValidate>
        <div className="flex flex-col items-center text-center">
          <img src="/icons/icon-192.png" alt="APEXOS" className="h-[104px] w-[104px] rounded-3xl" />
          <h1 className="text-gradient mt-4 text-[30px] font-extrabold tracking-[7px]">APEXOS</h1>
          <p className="mt-1 text-[13.5px] text-muted">Ingresa con tu cuenta de técnico</p>
        </div>
        {quick.length > 0 && (
          <div className="mt-8">
            <span className="mb-2 block text-[13px] font-semibold text-muted">Entrar con huella</span>
            <div className="flex flex-col gap-2.5">
              {quick.map((q) => (
                <button
                  key={q.userId}
                  type="button"
                  disabled={busy}
                  onClick={() => void enterWithFingerprint(q)}
                  className="panel flex w-full items-center gap-3 p-3 text-left active:opacity-80 disabled:opacity-60"
                  aria-label={`Entrar como ${q.name} con huella`}
                >
                  <GradientTile icon="fingerprint" size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{q.name}</span>
                    {q.email && <span className="block truncate text-[12.5px] text-muted">{q.email}</span>}
                  </span>
                  {entering === q.userId ? <Spinner size={18} /> : <Icon name="chevron" size={18} className="text-faint" />}
                </button>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 text-[12.5px] text-faint">
              <span className="h-px flex-1 bg-current opacity-30" />
              o con tu correo y clave
              <span className="h-px flex-1 bg-current opacity-30" />
            </div>
          </div>
        )}
        <label className={quick.length > 0 ? 'mt-4 block' : 'mt-8 block'}>
          <span className="mb-1.5 block text-[13px] font-semibold text-muted">Correo</span>
          <div className="relative">
            <Icon name="user" size={18} className="pointer-events-none absolute top-[15px] left-3.5 text-faint" />
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              className="field pl-10"
              placeholder="técnico@empresa.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!errors.email}
            />
          </div>
          {errors.email && <span className="mt-1 block text-xs text-bad">{errors.email}</span>}
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold text-muted">Contraseña</span>
          <div className="relative">
            <Icon name="shield" size={18} className="pointer-events-none absolute top-[15px] left-3.5 text-faint" />
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              className="field px-10"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password}
            />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute top-1 right-1 flex h-11 w-11 items-center justify-center text-muted">
              <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </div>
          {errors.password && <span className="mt-1 block text-xs text-bad">{errors.password}</span>}
        </label>
        <PrimaryButton type="submit" className="mt-6" busy={busy} icon="arrow">Ingresar</PrimaryButton>
        <p className="mt-6 text-center text-[12.5px] leading-relaxed text-muted">
          Si no puedes entrar, pide tus credenciales al coordinador de operaciones.
        </p>
      </form>
      {faceSheet}
    </div>
  );
}
