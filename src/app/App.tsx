import { UpdateBanner } from '../components/UpdateBanner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { FeedbackProvider } from '../components/feedback';
import { Icon, type IconName } from '../components/Icon';
import { env } from '../config/env';
import { isIos, isMobileDevice, isStandalone } from '../core/device';
import { AttendancePage } from '../modules/attendance/AttendancePage';
import { AuthProvider, useAuth } from '../modules/auth/AuthProvider';
import { LoginPage } from '../modules/auth/LoginPage';
import {
  canMarkAttendance, canSeeFinance, canSeeServices, canSeeTransport, isShareholder, type AppUser,
} from '../modules/auth/user';
import { ClosurePage } from '../modules/orders/ClosurePage';
import { ExecutionPage } from '../modules/orders/ExecutionPage';
import { InspectionPage } from '../modules/orders/InspectionPage';
import { OrderDetailPage } from '../modules/orders/OrderDetailPage';
import { OrdersListPage } from '../modules/orders/OrdersListPage';
import { HomePage, NotificationsPage, PersonalPage, ProfilePage, SettingsPage } from '../modules/profile/pages';
import { SyncCenterPage } from '../modules/sync/SyncCenterPage';
import { requestPersistentStorage } from '../storage/db';
import { SyncProvider } from '../sync/SyncProvider';
import { ApiException } from '../services/apiClient';

// Módulos de accionista en chunks aparte: el técnico no los descarga al abrir.
// El Service Worker los precachea igual, así que también abren sin señal.
const FinancePage = lazy(() => import('../modules/finance/FinancePage').then((m) => ({ default: m.FinancePage })));
const PygPage = lazy(() => import('../modules/finance/PygPage').then((m) => ({ default: m.PygPage })));
const transport = () => import('../modules/transport/TransportPages');
const TransportHomePage = lazy(() => transport().then((m) => ({ default: m.TransportHomePage })));
const FleetPage = lazy(() => transport().then((m) => ({ default: m.FleetPage })));
const SettlementTowerPage = lazy(() => transport().then((m) => ({ default: m.SettlementTowerPage })));
const SettlementDetailPage = lazy(() => transport().then((m) => ({ default: m.SettlementDetailPage })));
const TransportConfigPage = lazy(() => transport().then((m) => ({ default: m.TransportConfigPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sin señal el caché de IndexedDB responde; no tiene sentido reintentar
      // tres veces un 4xx ni mantener al usuario mirando un spinner.
      retry: (count, e) => count < 1 && !(e instanceof ApiException && !e.isRetryable),
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      networkMode: 'always',
    },
  },
});

export function App() {
  const [mobile] = useState(() => env.allowDesktop || isMobileDevice());
  if (!mobile) return <DesktopBlock />;
  return (
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <AuthProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
          <UpdateBanner />
        </AuthProvider>
      </FeedbackProvider>
    </QueryClientProvider>
  );
}

/** Bloqueo de escritorio (restricción de interfaz, no de seguridad). */
function DesktopBlock() {
  return (
    <div className="page-bg flex min-h-full flex-col items-center justify-center p-8 text-center">
      <img src="/icons/icon-192.png" alt="APEXOS" className="h-24 w-24 rounded-3xl" />
      <h1 className="text-gradient mt-5 text-3xl font-extrabold tracking-[6px]">APEXOS</h1>
      <p className="mt-4 max-w-md text-lg font-semibold">APEXOS Web Móvil es exclusivo para celulares.</p>
      <p className="mt-2 max-w-md text-sm text-muted">
        Abre esta misma dirección desde Chrome en Android o Safari en iPhone. Para trabajar desde un computador usa la web de APEXOS.
      </p>
      <p className="mt-6 rounded-xl border border-line bg-surface-alt px-4 py-2 font-mono text-sm text-teal">{window.location.origin}</p>
    </div>
  );
}

function Splash() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg">
      <h1 className="text-gradient text-[34px] font-extrabold tracking-[8px]">APEXOS</h1>
      <p className="mt-1 text-[13px] tracking-wide text-muted">Servicios en campo</p>
      <span className="spinner mt-6 h-[22px] w-[22px] text-teal" />
    </div>
  );
}

function Root() {
  const { status, user } = useAuth();
  useEffect(() => {
    if (status === 'authenticated') void requestPersistentStorage();
  }, [status]);
  if (status === 'unknown') return <Splash />;
  return (
    <SyncProvider userId={user ? String(user.id) : null}>
      <Routes>
        <Route path="/login" element={status === 'authenticated' ? <Navigate to="/inicio" replace /> : <LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route path="/inicio" element={<HomePage />} />
            <Route path="/servicios" element={<Guard allow={canSeeServices}><OrdersListPage /></Guard>} />
            <Route path="/transporte" element={<Guard allow={canSeeTransport}><TransportHomePage /></Guard>} />
            <Route path="/reportes" element={<Guard allow={canSeeFinance}><FinancePage /></Guard>} />
            <Route path="/notificaciones" element={<NotificationsPage />} />
            <Route path="/perfil" element={<ProfilePage />} />
          </Route>
          <Route path="/servicios/:id" element={<Guard allow={canSeeServices}><OrderDetailPage /></Guard>} />
          <Route path="/servicios/:id/inspeccion/:itemId" element={<Guard allow={canSeeServices}><InspectionPage /></Guard>} />
          <Route path="/servicios/:id/ejecucion/:itemId" element={<Guard allow={canSeeServices}><ExecutionPage /></Guard>} />
          <Route path="/servicios/:id/cierre" element={<Guard allow={canSeeServices}><ClosurePage /></Guard>} />
          <Route path="/reportes/pyg" element={<Guard allow={canSeeFinance}><PygPage /></Guard>} />
          <Route path="/transporte/flota" element={<Guard allow={canSeeTransport}><FleetPage /></Guard>} />
          <Route path="/transporte/liquidaciones" element={<Guard allow={canSeeTransport}><SettlementTowerPage /></Guard>} />
          <Route path="/transporte/liquidaciones/:id" element={<Guard allow={canSeeTransport}><SettlementDetailPage /></Guard>} />
          <Route path="/transporte/configuracion" element={<Guard allow={canSeeTransport}><TransportConfigPage /></Guard>} />
          <Route path="/personal" element={<PersonalPage />} />
          <Route path="/jornada" element={<Guard allow={canMarkAttendance}><AttendancePage /></Guard>} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="/sincronizacion" element={<SyncCenterPage />} />
        </Route>
        <Route path="*" element={<Navigate to={status === 'authenticated' ? '/inicio' : '/login'} replace />} />
      </Routes>
    </SyncProvider>
  );
}

/** Protección de rutas: sin sesión, al login (recordando a dónde iba). */
function RequireAuth() {
  const { status } = useAuth();
  const loc = useLocation();
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

/** Protección por rol/permiso: mismas reglas que las pestañas de Flutter. */
function Guard({ allow, children }: { allow: (u: AppUser) => boolean; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !allow(user)) return <Navigate to="/inicio" replace />;
  return <Suspense fallback={<div className="flex justify-center py-16"><span className="spinner h-6 w-6 text-teal" /></div>}>{children}</Suspense>;
}

interface Tab { to: string; label: string; icon: IconName }

function Shell() {
  const { user } = useAuth();
  const [installHint, setInstallHint] = useState(false);
  useEffect(() => {
    if (isIos() && !isStandalone()) {
      try {
        setInstallHint(localStorage.getItem('apexos-ios-hint') !== 'no');
      } catch {
        setInstallHint(true);
      }
    }
  }, []);
  if (!user) return null;
  const tabs: Tab[] = [
    { to: '/inicio', label: 'Inicio', icon: 'home' },
    ...(canSeeServices(user) ? [{ to: '/servicios', label: 'Servicios', icon: 'list' as IconName }] : []),
    ...(canSeeTransport(user) ? [{ to: '/transporte', label: 'Transporte', icon: 'truck' as IconName }] : []),
    ...(canSeeFinance(user) ? [{ to: '/reportes', label: 'Reportes', icon: 'chart' as IconName }] : []),
    ...(!isShareholder(user) ? [{ to: '/notificaciones', label: 'Avisos', icon: 'bell' as IconName }] : []),
    { to: '/perfil', label: 'Perfil', icon: 'user' },
  ];
  return (
    <div className="page-bg min-h-full">
      {installHint && (
        <div className="safe-top flex items-start gap-2 bg-info/15 px-4 py-2 text-xs text-ink">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-info" />
          <span className="flex-1">Para usar APEXOS como app en iPhone: toca Compartir y luego «Agregar a inicio».</span>
          <button type="button" className="font-bold text-info" onClick={() => { setInstallHint(false); try { localStorage.setItem('apexos-ios-hint', 'no'); } catch { /* sin storage */ } }}>OK</button>
        </div>
      )}
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-alt" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Navegación principal">
        <div className="flex h-[var(--nav-h)]">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11.5px] font-bold ${isActive ? 'text-teal' : 'text-muted'}`}>
              {({ isActive }) => (
                <>
                  <span className={`flex h-8 w-14 items-center justify-center rounded-full ${isActive ? 'bg-teal/15' : ''}`}><Icon name={t.icon} size={22} /></span>
                  {t.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
