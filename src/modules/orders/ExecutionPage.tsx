import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { PhotoButton } from '../../components/media';
import { CenterSpinner, InfoBox, PrimaryButton, ScreenHeader } from '../../components/ui';
import { storePhoto, type PreparedPhoto } from '../../services/media';
import { OutboxRequests, type OutboxDraft } from '../../sync/outboxRequests';
import { useSync } from '../../sync/SyncProvider';
import { useUser } from '../auth/AuthProvider';
import { itemTitle } from './model';
import { applyLocalStatus } from './ordersApi';
import { useOrder } from './OrderDetailPage';

const SLOTS = [
  { type: 'producto_abierto', title: '1. Producto abierto', hint: 'El empaque abierto, antes de armar' },
  { type: 'producto_cerrado', title: '2. Producto cerrado', hint: 'El mueble terminado y cerrado' },
] as const;

/**
 * Ejecución (port de `execution_screen.dart`). Las dos fotos son obligatorias.
 * Se encola: foto abierto → foto cerrado → estado `completada` de la solicitud.
 */
export function ExecutionPage() {
  const orderId = Number(useParams().id);
  const itemId = Number(useParams().itemId);
  const { data, isLoading } = useOrder(orderId);
  const user = useUser();
  const { enqueue } = useSync();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Record<string, PreparedPhoto | null>>({ producto_abierto: null, producto_cerrado: null });
  const [saving, setSaving] = useState(false);

  const item = data?.order.items.find((i) => i.id === itemId);
  if (isLoading || !data) return <><ScreenHeader title="Ejecución" /><CenterSpinner /></>;
  if (!item) return <><ScreenHeader title="Ejecución" /><p className="p-6 text-muted">La solicitud ya no existe en la orden.</p></>;

  const complete = SLOTS.every((s) => photos[s.type]);

  const finish = async () => {
    setSaving(true);
    try {
      const drafts: OutboxDraft[] = [];
      for (const s of SLOTS) {
        const f = await storePhoto(photos[s.type]!, String(user.id));
        drafts.push(OutboxRequests.photo({ orderId, itemId, type: s.type, fileId: f.id, fileName: f.name, mimeType: f.mime, sizeBytes: f.size }));
      }
      drafts.push(OutboxRequests.itemStatus(orderId, itemId, 'completada', item.version));
      await enqueue(drafts);
      await applyLocalStatus(orderId, { itemId, itemStatus: 'completada' });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      toast('Solicitud finalizada', 'ok');
      navigate(-1);
    } catch {
      toast('No fue posible guardar la ejecución', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-bg min-h-full">
      <ScreenHeader title="Ejecución" subtitle={itemTitle(item)} />
      <main className="space-y-3 p-3 pb-36">
        <InfoBox>Las dos fotos son obligatorias. Sin ellas el sistema no deja cerrar la solicitud.</InfoBox>
        {SLOTS.map((s) => {
          const p = photos[s.type];
          return (
            <section key={s.type} className={`rounded-[14px] border bg-surface p-3.5 ${p ? 'border-teal-solid' : 'border-line'}`}>
              <div className="mb-2 flex items-center gap-2">
                <Icon name={p ? 'checkCircle' : 'camera'} className={p ? 'text-teal' : 'text-faint'} />
                <div>
                  <p className="font-bold">{s.title}</p>
                  <p className="text-[12.5px] text-muted">{s.hint}</p>
                </div>
              </div>
              {p && <img src={p.previewUrl} alt={s.title} className="mb-2 h-[170px] w-full rounded-lg object-cover" />}
              <PhotoButton purpose={s.type} label="Tomar foto" retakeLabel="Repetir foto" value={p} onChange={(v) => setPhotos((x) => ({ ...x, [s.type]: v }))} />
            </section>
          );
        })}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-alt p-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        <PrimaryButton icon="checkCircle" disabled={!complete} busy={saving} onClick={() => void finish()}>
          Finalizar solicitud
        </PrimaryButton>
        {!complete && <p className="mt-1.5 text-center text-xs text-muted">Completa las 2 evidencias para continuar</p>}
      </div>
    </div>
  );
}
