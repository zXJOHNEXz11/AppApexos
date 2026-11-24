import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { SignaturePad } from '../../components/media';
import { CenterSpinner, OutlineButton, PrimaryButton, ScreenHeader } from '../../components/ui';
import { currentFix } from '../../services/location';
import { signatureFromCanvas, storePhoto } from '../../services/media';
import { OutboxRequests } from '../../sync/outboxRequests';
import { useSync } from '../../sync/SyncProvider';
import { useUser } from '../auth/AuthProvider';
import { applyLocalStatus, fetchSatisfactionQuestions } from './ordersApi';

/**
 * Cierre (port de `closure_screen.dart`): encuesta 1–5 de todas las preguntas
 * activas + firma del cliente. Se encola: firma (`firma_cliente`) → cierre con
 * GPS fresco (si lo hay) y la encuesta en `metadata.satisfaction_survey`.
 */
export function ClosurePage() {
  const orderId = Number(useParams().id);
  const user = useUser();
  const { enqueue } = useSync();
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const questions = useQuery({ queryKey: ['satisfaction-questions'], queryFn: fetchSatisfactionQuestions, retry: 0 });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const qs = questions.data ?? [];
  // Igual que `SatisfactionSurvey.covers`: sin preguntas activas no hay nada que responder.
  const surveyDone = questions.isSuccess && qs.every((q) => answers[q.id] >= 1 && answers[q.id] <= 5);
  const ready = surveyDone && signed && !saving;

  const close = async () => {
    if (!canvasRef.current) return;
    setSaving(true);
    try {
      const sig = await storePhoto(await signatureFromCanvas(canvasRef.current), String(user.id));
      const signatureDraft = OutboxRequests.photo({
        orderId, itemId: 0, type: 'firma_cliente', fileId: sig.id, fileName: sig.name, mimeType: sig.mime, sizeBytes: sig.size,
      });
      const fix = await currentFix().catch(() => null);
      const closeDraft = OutboxRequests.closeOrder({
        orderId,
        fix,
        metadata: {
          satisfaction_survey: { answers: qs.map((q) => ({ question_id: q.id, rating: answers[q.id] })) },
        },
      });
      await enqueue([signatureDraft, closeDraft]);
      await applyLocalStatus(orderId, { orderStatus: 'cerrada' });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      toast('Servicio cerrado', 'ok');
      navigate('/servicios', { replace: true });
    } catch (e) {
      toast(e instanceof Error && e.message.includes('2 MB') ? e.message : 'No fue posible guardar el cierre', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-bg min-h-full">
      <ScreenHeader title="Cierre del servicio" />
      <main className="space-y-3 p-3 pb-36">
        {questions.isLoading ? (
          <CenterSpinner />
        ) : questions.error ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <Icon name="cloudOff" size={40} className="text-faint" />
            <p className="mt-3 font-semibold">{(questions.error as Error).message || 'No fue posible cargar la encuesta'}</p>
            <p className="mt-1.5 text-sm text-muted">
              Conéctate una vez para descargar las preguntas de la empresa; después la app puede usar su última copia guardada.
            </p>
            <OutlineButton className="mt-4 w-44" icon="refresh" onClick={() => void questions.refetch()}>Reintentar</OutlineButton>
          </div>
        ) : (
          <>
            <h2 className="text-xs font-bold tracking-[.8px] text-teal uppercase">Encuesta de satisfacción</h2>
            <p className="-mt-1 text-sm text-muted">Pregúntale al cliente y marca su respuesta.</p>
            {qs.map((q) => (
              <fieldset key={q.id} className={`rounded-[14px] border bg-surface p-3.5 ${answers[q.id] ? 'border-teal-solid' : 'border-line'}`}>
                <legend className="sr-only">{q.label}</legend>
                <p className="mb-2.5 text-sm font-semibold">{q.label}</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={answers[q.id] === n}
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: n }))}
                      className={`h-12 rounded-xl border text-base font-bold ${answers[q.id] === n ? 'border-teal-solid bg-teal-solid text-white' : 'border-line text-muted'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
                  <span>1 · Malo</span>
                  <span>5 · Excelente</span>
                </div>
              </fieldset>
            ))}
            <h2 className="pt-2 text-xs font-bold tracking-[.8px] text-teal uppercase">Firma del cliente</h2>
            <p className="-mt-1 text-sm text-muted">El cliente firma con el dedo sobre el recuadro.</p>
            <SignaturePad canvasRef={canvasRef} onChange={setSigned} />
          </>
        )}
      </main>
      {!questions.error && !questions.isLoading && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-alt p-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
          <PrimaryButton icon="shield" disabled={!ready} busy={saving} onClick={() => void close()}>
            Cerrar servicio
          </PrimaryButton>
          {!surveyDone ? (
            <p className="mt-1.5 text-center text-xs font-semibold text-warn">Responde la encuesta para continuar</p>
          ) : !signed ? (
            <p className="mt-1.5 text-center text-xs font-semibold text-warn">Falta la firma del cliente</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
