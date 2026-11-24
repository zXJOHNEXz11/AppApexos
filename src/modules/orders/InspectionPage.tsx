import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { PhotoButton } from '../../components/media';
import { CenterSpinner, GradientTile, OutlineButton, Panel, PrimaryButton, ScreenHeader } from '../../components/ui';
import { newClientUuid } from '../../core/ids';
import { storePhoto, type PreparedPhoto } from '../../services/media';
import { OutboxRequests, type OutboxDraft } from '../../sync/outboxRequests';
import { useSync } from '../../sync/SyncProvider';
import { useUser } from '../auth/AuthProvider';
import { itemTitle, PIECE_ACTION_LABEL, pieceQuantityLabel, type Piece, type PieceAction, type PieceCondition } from './model';
import { applyLocalStatus } from './ordersApi';
import { useOrder } from './OrderDetailPage';

interface Check {
  piece: Piece;
  condition: PieceCondition;
  action: PieceAction;
  comment: string;
  photo: PreparedPhoto | null;
}

const CONDITIONS: { value: PieceCondition; label: string; color: string }[] = [
  { value: 'ok', label: 'OK', color: '#0D9488' },
  { value: 'averiada', label: 'Averiada', color: '#F59E0B' },
  { value: 'faltante', label: 'Faltante', color: '#EF4444' },
];

/**
 * Inspección de una solicitud (port de `inspection_screen.dart`).
 * Toda pieza con novedad exige foto de soporte. Se encola, EN ESTE ORDEN:
 * fotos de piezas → inspección → (armable) ejecución | (no armable) novedad.
 */
export function InspectionPage() {
  const orderId = Number(useParams().id);
  const itemId = Number(useParams().itemId);
  const { data, isLoading } = useOrder(orderId);
  const user = useUser();
  const { enqueue } = useSync();
  const { toast, prompt } = useFeedback();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [saving, setSaving] = useState(false);

  const item = data?.order.items.find((i) => i.id === itemId);

  useEffect(() => {
    if (item && checks === null) {
      setChecks(item.pieces.map((piece) => ({ piece, condition: 'ok', action: 'ninguna', comment: '', photo: null })));
    }
  }, [item, checks]);

  if (isLoading || !data) return <><ScreenHeader title="Inspección" /><CenterSpinner /></>;
  if (!item) return <><ScreenHeader title="Inspección" /><p className="p-6 text-muted">La solicitud ya no existe en la orden.</p></>;

  if (item.pieces.length === 0) {
    return (
      <>
        <ScreenHeader title="Inspección" subtitle={itemTitle(item)} />
        <div className="flex flex-col items-center px-8 py-14 text-center">
          <Icon name="box" size={42} className="text-faint" />
          <p className="mt-3 text-[15px] font-semibold">Esta referencia no tiene despiece cargado</p>
          <p className="mt-1.5 text-sm text-muted">
            El coordinador tiene que registrar las piezas de la referencia en el monitor para poder inspeccionarla.
          </p>
          <OutlineButton className="mt-5 w-40" onClick={() => navigate(-1)}>Volver</OutlineButton>
        </div>
      </>
    );
  }

  const list = checks ?? [];
  const problems = list.filter((c) => c.condition !== 'ok');
  const missing = problems.filter((c) => !c.photo).length;
  const update = (idx: number, patch: Partial<Check>) =>
    setChecks((cs) => cs!.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const finish = async (decision: 'armable' | 'no_armable') => {
    if (missing > 0) {
      toast('Toma la foto de soporte de cada pieza con novedad', 'warn');
      return;
    }
    let description: string | null = null;
    if (decision === 'no_armable') {
      description = await prompt({
        title: 'Producto no armable',
        message: 'Cuenta qué encontraste. Esto es lo que va a leer el coordinador para resolver.',
        input: { label: 'Describe el problema', placeholder: 'Ej: falta el herraje central y la puerta no cierra' },
        confirm: 'Reportar novedad',
        danger: true,
      });
      if (!description) return;
    }
    setSaving(true);
    try {
      const drafts: OutboxDraft[] = [];
      for (const c of list) {
        if (c.condition === 'ok' || !c.photo) continue;
        const f = await storePhoto(c.photo, String(user.id));
        drafts.push(OutboxRequests.photo({
          orderId, itemId, type: 'pieza', fileId: f.id, fileName: f.name, mimeType: f.mime, sizeBytes: f.size,
          metadata: { piece_id: c.piece.id },
        }));
      }
      drafts.push(OutboxRequests.inspection({
        orderId, itemId, clientUuid: newClientUuid(), decision,
        items: list.map((c) => ({
          part_id: c.piece.id,
          name: c.piece.name,
          quantity: c.piece.quantity,
          unit: c.piece.unit,
          status: c.condition,
          comment: c.comment,
          action: c.action,
          supplier_name: '',
        })),
      }));
      drafts.push(decision === 'armable'
        ? OutboxRequests.execution(orderId, itemId)
        : OutboxRequests.incident({ orderId, itemId, type: 'no_armable', description: description! }));
      await enqueue(drafts);

      if (decision === 'armable') {
        await applyLocalStatus(orderId, { itemId, itemStatus: 'ejecucion', orderStatus: 'ejecucion' });
        toast('Inspección guardada. Producto armable.', 'ok');
      } else {
        await applyLocalStatus(orderId, { itemId, itemStatus: 'bloqueada' });
        toast('Novedad reportada. La solicitud queda en revisión.', 'warn');
      }
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      navigate(-1);
    } catch {
      toast('No fue posible guardar la inspección', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-bg min-h-full">
      <ScreenHeader title="Inspección" subtitle={itemTitle(item)} />
      <main className="space-y-3 p-3 pb-44">
        <Panel>
          <p className={`flex items-center gap-2 text-[13px] ${problems.length ? 'font-semibold text-warn' : 'text-muted'}`}>
            <Icon name="task" size={18} className="text-teal" />
            {problems.length === 0 ? `${list.length} piezas · todas OK` : `${list.length} piezas · ${problems.length} con novedad`}
          </p>
        </Panel>
        {list.map((c, idx) => (
          <Panel key={c.piece.id}>
            <div className="flex items-center gap-3">
              <GradientTile icon="box" gradient={c.condition === 'ok' ? 'teal' : 'amber'} size={34} />
              <div className="min-w-0">
                <p className="text-[15px] font-bold">{idx + 1}. {c.piece.name}</p>
                <p className="text-xs text-muted">{pieceQuantityLabel(c.piece)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Estado de ${c.piece.name}`}>
              {CONDITIONS.map((opt) => {
                const sel = c.condition === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => update(idx, opt.value === 'ok' ? { condition: 'ok', action: 'ninguna', photo: null } : { condition: opt.value })}
                    className={`h-12 rounded-[14px] border text-[15px] font-semibold ${sel ? 'text-white' : 'border-line text-muted'}`}
                    style={sel ? { background: opt.color, borderColor: opt.color } : undefined}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {c.condition !== 'ok' && (
              <div className="mt-3 space-y-2.5">
                <input className="field" placeholder="Qué le pasa a esta pieza" value={c.comment} onChange={(e) => update(idx, { comment: e.target.value })} />
                <label className="block">
                  <span className="mb-1 block text-[13px] text-muted">Qué hacer con la pieza</span>
                  <select className="field" value={c.action} onChange={(e) => update(idx, { action: e.target.value as PieceAction })}>
                    {(Object.keys(PIECE_ACTION_LABEL) as PieceAction[]).map((a) => (
                      <option key={a} value={a}>{PIECE_ACTION_LABEL[a]}</option>
                    ))}
                  </select>
                </label>
                <PhotoButton
                  purpose="pieza"
                  label="Foto de soporte"
                  retakeLabel="Repetir foto de soporte"
                  tone="red"
                  value={c.photo}
                  onChange={(p) => update(idx, { photo: p })}
                />
              </div>
            )}
          </Panel>
        ))}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-alt p-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        {missing > 0 && (
          <p className="mb-2 text-center text-[12.5px] font-semibold text-warn">
            {missing === 1 ? 'Falta la foto de soporte de 1 pieza' : `Faltan fotos de soporte de ${missing} piezas`}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <OutlineButton tone="red" icon="x" className="h-[52px]" disabled={missing > 0 || saving} onClick={() => void finish('no_armable')}>
            No armable
          </OutlineButton>
          <PrimaryButton icon="tool" busy={saving} disabled={missing > 0} onClick={() => void finish('armable')}>
            Armable
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
