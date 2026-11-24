import { useNavigate } from 'react-router-dom';
import { TopBar } from '../../app/TopBar';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { SyncBanner } from '../../components/SyncBanner';
import { EmptyState, ModuleCard, OutlineButton, Panel, ScreenHeader, SectionTitle } from '../../components/ui';
import { env } from '../../config/env';
import { useSync } from '../../sync/SyncProvider';
import { useAuth, useUser } from '../auth/AuthProvider';
import {
  canMarkAttendance, canSeeFinance, canSeeServices, canSeeTransport, initials, isShareholder,
} from '../auth/user';
import { useOrders } from '../orders/OrdersListPage';
import { inTab } from '../orders/model';

/** Inicio (port de `home_screen.dart`). */
export function HomePage() {
  const user = useUser();
  const navigate = useNavigate();
  const services = canSeeServices(user);
  const orders = useOrders();
  const active = services ? (orders.data?.orders ?? []).filter((o) => inTab(o, 'pendientes') || inTab(o, 'enCurso')).length : 0;
  const shareholder = isShareholder(user);
  return (
    <div className="pb-nav">
      <TopBar />
      <SyncBanner />
      <div className="px-4 pt-2 pb-5">
        <p className="text-sm text-muted">Bienvenido,</p>
        <p className="truncate text-[28px] leading-tight font-extrabold">{user.name || 'Técnico'}</p>
        <p className="text-[13.5px] text-muted">¡Qué bueno verte de nuevo!</p>
      </div>
      <div className="space-y-3 px-4">
        <SectionTitle>Módulos</SectionTitle>
        {services && (
          <ModuleCard icon="tool" gradient="teal" title="Servicios" subtitle="Gestiona y da seguimiento a los servicios técnicos." badge={active ? `${active} activo${active === 1 ? '' : 's'}` : null} onClick={() => navigate('/servicios')} />
        )}
        {shareholder ? (
          <>
            {canSeeFinance(user) && <ModuleCard icon="chart" gradient="teal" title="Reportes financieros" subtitle="Balance, resultados, impuestos, cartera y proveedores." onClick={() => navigate('/reportes')} />}
            {canSeeTransport(user) && <ModuleCard icon="truck" gradient="blue" title="Transporte" subtitle="PYG por vehículo, liquidaciones y costos de la flota." onClick={() => navigate('/transporte')} />}
            {!canSeeFinance(user) && !canSeeTransport(user) && (
              <Panel>
                <p className="text-[13.5px] text-muted">
                  Tu rol de accionista todavía no tiene acceso a Contabilidad ni a Transporte. Pide al administrador que le dé permiso de consulta a esos módulos, o que la empresa los tenga activos.
                </p>
              </Panel>
            )}
          </>
        ) : (
          <ModuleCard icon="users" gradient="blue" title="Personal" subtitle="Tu jornada, marcaciones y datos de cuenta." onClick={() => navigate('/personal')} />
        )}
        <ModuleCard icon="sync" gradient="violet" title="Sincronización" subtitle="Estado de la cola, envíos pendientes y sincronizar ahora." onClick={() => navigate('/sincronizacion')} />
      </div>
    </div>
  );
}

/** Notificaciones (port: la app no tiene fuente de API; muestra el estado de la cola). */
export function NotificationsPage() {
  const { failedCount, openCount } = useSync();
  return (
    <div className="pb-nav">
      <TopBar title="Notificaciones" />
      <SyncBanner />
      <div className="px-3 pt-3">
        <Panel className="flex items-center gap-3">
          <Icon name={failedCount ? 'alert' : openCount ? 'upload' : 'checkCircle'} className={failedCount ? 'text-bad' : openCount ? 'text-warn' : 'text-teal'} />
          <p className="text-sm">
            {failedCount ? 'Tienes envíos que no salieron. Revísalos desde el aviso de arriba.' : openCount ? 'Hay trabajo tuyo esperando señal para subir.' : 'Todo tu trabajo está sincronizado.'}
          </p>
        </Panel>
      </div>
      <EmptyState icon="bell" title="Sin notificaciones" message="Cuando la operación te envíe avisos, aparecerán aquí." />
    </div>
  );
}

/** Perfil (port de `profile_screen.dart`) con cierre de sesión controlado. */
export function ProfilePage() {
  const user = useUser();
  const { logout } = useAuth();
  const { openCount, failedCount, sync, online } = useSync();
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();

  const doLogout = async () => {
    const pending = openCount + failedCount;
    if (pending > 0) {
      if (online) {
        const r = await sync({ force: true });
        if (r && r.sent > 0) toast(`Se enviaron ${r.sent} operación(es) antes de salir`, 'ok');
      }
    }
    const stillPending = pending > 0;
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: stillPending
        ? `Tienes ${pending} operación(es) sin confirmar por el servidor.\n\nNo se borrarán: quedan guardadas en este teléfono y se enviarán cuando vuelvas a entrar con tu misma cuenta. Si otra persona usa este teléfono, no podrá verlas ni enviarlas.`
        : 'Se cerrará tu sesión en este dispositivo.',
      confirm: 'Salir',
      danger: true,
    });
    if (ok) {
      await logout();
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="pb-nav">
      <TopBar title="Perfil" />
      <div className="space-y-3 px-3">
        <Panel className="flex items-center gap-4">
          <span className="grad-teal flex h-[60px] w-[60px] items-center justify-center rounded-full text-xl font-extrabold text-white">{initials(user)}</span>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{user.name || 'Técnico'}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
        </Panel>
        <Panel>
          <div className="flex justify-between py-1 text-sm"><span className="text-muted">Empresa</span><span>{user.tenantName || '—'}</span></div>
          <div className="flex justify-between py-1 text-sm"><span className="text-muted">Rol</span><span>{user.roleName || '—'}</span></div>
        </Panel>
        {canMarkAttendance(user) && <ModuleCard icon="fingerprint" gradient="teal" title="Marcaciones y jornadas" subtitle="Marca tu jornada con selfie y GPS." onClick={() => navigate('/jornada')} />}
        <ModuleCard icon="settings" gradient="blue" title="Configuración de usuario" subtitle="Datos de cuenta, empresa y dispositivo." onClick={() => navigate('/ajustes')} />
        <ModuleCard icon="sync" gradient="violet" title="Sincronización" subtitle="Cola de envíos y sincronizar ahora." onClick={() => navigate('/sincronizacion')} />
        <OutlineButton tone="red" icon="logout" className="w-full" onClick={() => void doLogout()}>Cerrar sesión</OutlineButton>
      </div>
    </div>
  );
}

/** Personal (port de `personal_screen.dart`). */
export function PersonalPage() {
  const user = useUser();
  const navigate = useNavigate();
  return (
    <div>
      <ScreenHeader title="Personal" />
      <div className="space-y-3 p-4">
        <div>
          <h1 className="text-xl font-extrabold">Tu jornada y tu cuenta</h1>
          <p className="text-[13px] text-muted">Marca tu entrada y salida, y revisa tus datos.</p>
        </div>
        {canMarkAttendance(user) && <ModuleCard icon="fingerprint" gradient="teal" title="Marcaciones y jornadas" subtitle="Marca tu jornada con selfie y GPS." onClick={() => navigate('/jornada')} />}
        <ModuleCard icon="settings" gradient="blue" title="Configuración de usuario" subtitle="Datos de cuenta y empresa." onClick={() => navigate('/ajustes')} />
      </div>
    </div>
  );
}

/** Configuración de usuario (solo lectura, como en la app) + datos del dispositivo. */
export function SettingsPage() {
  const user = useUser();
  return (
    <div>
      <ScreenHeader title="Configuración de usuario" />
      <div className="space-y-3 p-3">
        <Panel className="flex items-center gap-3">
          <span className="grad-teal flex h-[54px] w-[54px] items-center justify-center rounded-full font-extrabold text-white">{initials(user)}</span>
          <div className="min-w-0"><p className="truncate font-bold">{user.name}</p><p className="text-sm text-teal">{user.roleName}</p></div>
        </Panel>
        <Panel>
          <Row label="Correo" value={user.email} />
          <Row label="Empresa" value={user.tenantName || 'Sin empresa asignada'} />
        </Panel>
        <Panel>
          <Row label="Ambiente" value={env.environment} />
          <Row label="Versión" value={__APP_VERSION__} />
          <Row label="Instalada como app" value={window.matchMedia('(display-mode: standalone)').matches ? 'Sí' : 'No'} />
        </Panel>
        <p className="px-1 text-xs text-faint">Las credenciales se administran desde el módulo de identidad de la web de APEXOS.</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  );
}
