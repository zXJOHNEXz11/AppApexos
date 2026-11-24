import { useNavigate } from 'react-router-dom';
import { ConnectionPill } from '../components/SyncBanner';
import { useAuth } from '../modules/auth/AuthProvider';
import { initials } from '../modules/auth/user';

/** Encabezado de las pestañas principales: marca, estado de conexión y avatar. */
export function TopBar({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="safe-top px-4 pt-3 pb-3">
      <div className="flex items-center gap-2">
        <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
        <span className="text-[15px] font-extrabold tracking-[3px]">APEXOS</span>
        <span className="flex-1" />
        <ConnectionPill />
        <button
          type="button"
          aria-label="Abrir mi perfil"
          onClick={() => navigate('/perfil')}
          className="grad-teal flex h-[42px] w-[42px] items-center justify-center rounded-full text-sm font-extrabold text-white"
        >
          {initials(user)}
        </button>
      </div>
      {title && <h1 className="mt-4 text-2xl font-extrabold">{title}</h1>}
      {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
    </header>
  );
}
