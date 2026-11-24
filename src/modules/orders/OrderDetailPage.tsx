import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFeedback } from '../../components/feedback';
import { Icon, type IconName } from '../../components/Icon';
import { SyncBanner } from '../../components/SyncBanner';
import { CenterSpinner, EmptyState, OutlineButton, Panel, ScreenHeader, SolidButton, StatusBadge } from '../../components/ui';
import { formatDate, formatDateTime, formatQuantity, formatRelativeDay } from '../../core/format';
import { currentFix } from '../../services/location';
import { OutboxRequests } from '../../sync/outboxRequests';
import { useSync } from '../../sync/SyncProvider';
import {
  completedItems, isActive, isPending, itemTitle, nextRequest, STATUS_LABEL, stepOf, type ServiceOrder,
} from './model';
import { applyLocalStatus, fetchOrder } from './ordersApi';

export function useOrder(id: number) {
  return useQuery({ queryKey: ['order', id], queryFn: () => fetchOrder(id) });
}

export function OrderDetailPage() {
  const id = Number(useParams().id);
  const { data, isLoading, error, refetch } = useOrder(id);
  const { pendingForOrder, enqueue } = useSync();
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  // Cuando la cola de ESTA orden se vacía, se relee del servidor.
  const pending = pendingForOrder(id);
  const prev = useRef(pending);
  useEffect(() => {
    if (prev.current > 0 && pending === 0) void refetch();
    prev.current = pending;
  }, [pending, refetch]);

  const order = data?.order;

  const start = async (o: ServiceOrder) => {
    const ok = await confirm({
      title: 'Iniciar servicio',
      message: `Vas a iniciar el servicio de ${o.customerName}. Hazlo solo cuando ya estés en el sitio.`,
      confirm: 'Iniciar',
    });
    if (!ok) return;
    setStarting(true);
    try {
      // La API acepta ubicación opcional en el inicio; nunca bloquea.
      const fix = await currentFix().catch(() => null);
      await enqueue([OutboxRequests.startOrder(o.id, fix)]);
      await applyLocalStatus(o.id, { orderStatus: 'en_curso', startedAt: new Date().toISOString() });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['order', o.id] });
      toast('Servicio iniciado', 'ok');
    } catch {
      toast('No fue posible guardar el inicio del servicio', 'bad');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={order?.number || 'Servicio'} subtitle={pending > 0 ? `${pending} operación(es) por subir` : undefined} />
      <SyncBanner />
      <main className="flex-1 space-y-3 p-3 pb-28">
        {isLoading ? (
          <CenterSpinner />
        ) : !order ? (
          <EmptyState icon="alert" title="No se pudo abrir el servicio" message={(error as Error)?.message} onRetry={() => void refetch()} />
        ) : (
          <>
            {data?.fromCache && pending === 0 && (
              <p className="rounded-lg bg-surface-alt px-3 py-2 text-xs text-muted">Mostrando la copia guardada en el teléfono.</p>
            )}
            <CustomerPanel order={order} />
            <ProgressPanel step={stepOf(order.status)} />
            <Panel>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-bold">Solicitudes</h2>
                <span className="text-[12.5px] text-muted">
                  {completedItems(order)} de {order.items.length} terminadas
                </span>
              </div>
              {order.items.length === 0 ? (
                <p className="text-sm text-muted">Esta orden no tiene solicitudes registradas.</p>
              ) : (
                <div className="space-y-2">
                  {order.items.map((i) => (
                    <div key={i.id} className="rounded-[10px] border border-line bg-surface-alt p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[14.5px] font-semibold">{itemTitle(i)}</p>
                        <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} compact />
                      </div>
                      <p className="mt-1 text-[12.5px] text-muted">
                        {formatQuantity(i.quantity)} pieza(s) · {i.serviceType}
                      </p>
                      {i.description && <p className="mt-1 text-[13px] text-ink/90">{i.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            {order.notes && (
              <Panel>
                <h2 className="mb-1 text-base font-bold">Observaciones</h2>
                <p className="text-sm whitespace-pre-line text-muted">{order.notes}</p>
              </Panel>
            )}
            {order.noExecutionReason && (
              <Panel border="rgba(239,68,68,.4)">
                <h2 className="mb-1 text-base font-bold text-bad">Motivo de no ejecución</h2>
                <p className="text-sm text-muted">{order.noExecutionReason}</p>
              </Panel>
            )}
          </>
        )}
      </main>
      {order && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-alt p-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
          <BottomAction order={order} starting={starting} onStart={() => void start(order)} onGo={(path) => navigate(path)} />
        </div>
      )}
    </div>
  );
}

function BottomAction({ order, starting, onStart, onGo }: {
  order: ServiceOrder;
  starting: boolean;
  onStart: () => void;
  onGo: (path: string) => void;
}) {
  if (isPending(order.status)) {
    return (
      <SolidButton className="w-full" icon="play" busy={starting} onClick={onStart}>
        Iniciar servicio
      </SolidButton>
    );
  }
  if (isActive(order.status)) {
    const next = nextRequest(order);
    if (next) {
      const path = next.status === 'ejecucion'
        ? `/servicios/${order.id}/ejecucion/${next.id}`
        : `/servicios/${order.id}/inspeccion/${next.id}`;
      return (
        <SolidButton className="w-full" icon="arrow" onClick={() => onGo(path)}>
          Continuar servicio
        </SolidButton>
      );
    }
    return (
      <SolidButton className="w-full" icon="shield" onClick={() => onGo(`/servicios/${order.id}/cierre`)}>
        Cerrar servicio
      </SolidButton>
    );
  }
  return (
    <OutlineButton className="w-full" tone="muted" disabled>
      Servicio {STATUS_LABEL[order.status].toLowerCase()}
    </OutlineButton>
  );
}

function CustomerPanel({ order }: { order: ServiceOrder }) {
  const { toast } = useFeedback();
  const date = order.scheduledDate ? new Date(order.scheduledDate) : null;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.customerAddress)}`;
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold tracking-[1.1px] text-muted uppercase">Cliente</span>
        <StatusBadge status={order.status} label={STATUS_LABEL[order.status]} />
      </div>
      <p className="mt-1 text-2xl font-bold select-text">{order.customerName}</p>
      <div className="mt-2 space-y-1.5">
        <Row icon="pin" text={order.customerAddress} action={<ActionLink href={mapUrl} icon="pin" label="Ver en el mapa" external />} />
        {order.customerPhone && (
          <Row
            icon="phone"
            text={order.customerPhone}
            onLongPress={() => {
              void navigator.clipboard?.writeText(order.customerPhone!).then(() => toast('Teléfono copiado', 'ok'));
            }}
            action={<ActionLink href={`tel:${order.customerPhone}`} icon="phone" label="Llamar" />}
          />
        )}
        <Row icon="calendar" text={`${formatRelativeDay(date)} · ${formatDate(date)}`} />
        {order.invoiceNumber && <Row icon="receipt" text={`Factura ${order.invoiceNumber}`} />}
        {order.startedAt && <Row icon="play" text={`Iniciado el ${formatDateTime(new Date(order.startedAt))}`} />}
        {order.closedAt && <Row icon="checkCircle" text={`Cerrado el ${formatDateTime(new Date(order.closedAt))}`} />}
      </div>
    </Panel>
  );
}

function Row({ icon, text, action, onLongPress }: { icon: IconName; text: string; action?: React.ReactNode; onLongPress?: () => void }) {
  return (
    <div className="flex items-center gap-2" onContextMenu={(e) => { if (onLongPress) { e.preventDefault(); onLongPress(); } }}>
      <Icon name={icon} size={17} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 text-sm text-muted">{text}</span>
      {action}
    </div>
  );
}

function ActionLink({ href, icon, label, external }: { href: string; icon: IconName; label: string; external?: boolean }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[9px] bg-teal/10 text-teal"
    >
      <Icon name={icon} size={18} />
    </a>
  );
}

const STEPS = ['Inicio', 'Inspección', 'Ejecución', 'Cierre'];

function ProgressPanel({ step }: { step: number }) {
  return (
    <Panel>
      <h2 className="mb-3 text-[13px] font-bold text-teal">Avance de la orden</h2>
      <div className="flex items-center">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center last:flex-none">
            <span
              className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${
                i < step ? 'grad-brand text-white' : i === step ? 'border-[2.4px] border-teal bg-bg' : 'border-2 border-line'
              }`}
            >
              {i < step ? <Icon name="check" size={14} strokeWidth={3} /> : i === step ? <span className="h-2 w-2 rounded-full bg-teal" /> : null}
            </span>
            {i < STEPS.length - 1 && <span className={`mx-1 h-0.5 flex-1 ${i < step ? 'bg-teal' : 'bg-line'}`} />}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between">
        {STEPS.map((s, i) => (
          <span key={s} className={`text-[11.5px] font-bold ${i > step ? 'text-faint' : 'text-ink'}`}>
            {s}
          </span>
        ))}
      </div>
    </Panel>
  );
}
