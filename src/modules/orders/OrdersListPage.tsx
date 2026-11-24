import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { SyncBanner } from '../../components/SyncBanner';
import { CenterSpinner, EmptyState, StatusBadge } from '../../components/ui';
import { formatDateTime, formatRelativeDay } from '../../core/format';
import { TopBar } from '../../app/TopBar';
import { inTab, isActive, sortOrders, STATUS_LABEL, TAB_LABEL, type OrderTab, type ServiceOrder } from './model';
import { fetchOrders } from './ordersApi';

const TAB_ICON: Record<OrderTab, IconName> = { pendientes: 'clock', enCurso: 'play', completados: 'checkCircle' };
const EMPTY_TITLE: Record<OrderTab, string> = {
  pendientes: 'No tienes servicios pendientes',
  enCurso: 'No tienes servicios en curso',
  completados: 'Aún no hay servicios completados',
};

export function useOrders() {
  return useQuery({ queryKey: ['orders'], queryFn: fetchOrders });
}

export function OrdersListPage() {
  const { data, isLoading, error, refetch, isFetching } = useOrders();
  const [tab, setTab] = useState<OrderTab>('pendientes');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders
      .filter((o) => inTab(o, tab))
      .filter((o) => !q || [o.customerName, o.number, o.customerAddress].some((s) => s.toLowerCase().includes(q)))
      .sort(sortOrders);
  }, [orders, tab, search]);

  return (
    <div className="pb-nav">
      <TopBar title="Mis servicios" subtitle="Gestiona tus servicios y registra tu avance." />
      <SyncBanner />
      {data?.fromCache && (
        <p className="mx-3 mt-2 rounded-lg bg-surface-alt px-3 py-2 text-xs text-muted">
          Sin conexión: mostrando la copia guardada del {formatDateTime(new Date(data.updatedAt))}.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 px-3 pt-2">
        {(Object.keys(TAB_LABEL) as OrderTab[]).map((t) => {
          const active = t === tab;
          const count = orders.filter((o) => inTab(o, t)).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex flex-col items-center rounded-[14px] border py-2 transition ${active ? 'border-teal/45 bg-teal/10 text-teal' : 'border-line bg-surface-alt text-muted'}`}
            >
              <Icon name={TAB_ICON[t]} size={18} />
              <span className={`text-lg font-bold ${active ? '' : 'text-ink'}`}>{count}</span>
              <span className="text-[11.5px] font-semibold">{TAB_LABEL[t]}</span>
            </button>
          );
        })}
      </div>
      <div className="relative px-3 pt-3">
        <Icon name="search" size={18} className="pointer-events-none absolute top-[27px] left-7 text-faint" />
        <input
          type="search"
          className="field pl-10"
          placeholder="Buscar por cliente, OS o dirección"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          enterKeyHint="search"
        />
      </div>

      <div className="flex items-center justify-end px-3 pt-2">
        <button type="button" onClick={() => void refetch()} className="flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-teal">
          <Icon name="refresh" size={15} className={isFetching ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {isLoading ? (
        <CenterSpinner />
      ) : error && !data ? (
        <EmptyState icon="cloudOff" title="No se pudo cargar" message={(error as Error).message} onRetry={() => void refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState icon={TAB_ICON[tab]} title={EMPTY_TITLE[tab]} message="Toca Actualizar para consultar de nuevo." />
      ) : (
        <div className="space-y-2.5 px-3 pb-6">
          {visible.map((o) => (
            <OrderCard key={o.id} order={o} onClick={() => navigate(`/servicios/${o.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, onClick }: { order: ServiceOrder; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="panel block w-full p-4 text-left active:opacity-80" style={isActive(order.status) ? { borderColor: 'rgba(45,212,191,.45)' } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold tracking-wide text-teal">{order.number}</span>
        <StatusBadge status={order.status} label={STATUS_LABEL[order.status]} compact />
      </div>
      <p className="mt-1 truncate text-lg font-bold">{order.customerName}</p>
      <p className="mt-0.5 flex items-start gap-1 text-[13.5px] text-muted">
        <Icon name="pin" size={15} className="mt-0.5 shrink-0 text-faint" />
        <span className="line-clamp-2">{order.customerAddress}</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <Chip icon="calendar" text={formatRelativeDay(order.scheduledDate ? new Date(order.scheduledDate) : null)} />
        <Chip icon="box" text={`${order.items.length} solicitud(es)`} />
        <span className="flex-1" />
        <Icon name="chevron" className="text-faint" />
      </div>
    </button>
  );
}

function Chip({ icon, text }: { icon: IconName; text: string }) {
  return (
    <span className="flex items-center gap-1 rounded-lg border border-line bg-surface-alt px-2 py-1 text-xs text-muted">
      <Icon name={icon} size={13} /> {text}
    </span>
  );
}
