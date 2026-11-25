import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkEnrollmentPhoto, compareSelfie, FACE_MESSAGES, preloadFaceModel, type FaceCheck } from '../../services/face';
import { enrollFace, fetchFaceEnrollment, type FaceEnrollment } from './faceApi';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../storage/db';
import {
  fetchOwnCredentials, fingerprintRequired, platformAuthenticatorAvailable, quickLoginUsers, registerFingerprint, signPunchWithFingerprint,
} from '../../services/webauthn';
import { useEffect, useMemo, useState } from 'react';
import { BottomSheet, useFeedback } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { PhotoButton } from '../../components/media';
import { SyncBanner } from '../../components/SyncBanner';
import { CenterSpinner, GradientTile, InfoBox, Panel, PrimaryButton, ScreenHeader } from '../../components/ui';
import { formatTime, todayIso } from '../../core/format';
import { newClientUuid } from '../../core/ids';
import { GPS_MESSAGES, gpsQuality, readLocation, type GpsReading } from '../../services/location';
import { storePhoto, type PreparedPhoto } from '../../services/media';
import { OutboxRequests } from '../../sync/outboxRequests';
import { useSync } from '../../sync/SyncProvider';
import { useUser } from '../auth/AuthProvider';
import { PunchHistory } from './PunchHistory';
import { IDENTITY_NOT_ENABLED, isRouteMissing } from '../../services/apiClient';
import {
  EXTENSION_REASONS, fetchActivityTypes, fetchRoutes, fetchTodayPunches, fetchWorkSession, isAvailable, LATE_REASONS,
  MILEAGE_RE, minuteOfDay, needsSelfie, PUNCHES, type PunchType, type WorkActivity,
} from './attendanceApi';

interface Mark {
  type: PunchType;
  at: Date;
  synced: boolean;
  failed: boolean;
  gpsQuality: string;
}

const GPS_LABEL: Record<string, string> = {
  gps_confirmado: 'GPS confirmado',
  gps_aproximado: 'GPS aproximado',
  sin_gps_ubicacion_apagada: 'Sin GPS: ubicación apagada',
  sin_gps_permiso_negado: 'Sin GPS: permiso negado',
  sin_gps_sin_senal: 'Sin GPS: sin señal',
  sin_gps: 'Sin GPS',
};

/**
 * Control de horarios (port de `attendance_screen.dart`) por el canal WEB del
 * backend: selfie sin firma de dispositivo (`photo_only`). Toda marcación va
 * por la cola: sin señal se guarda y sale sola cuando vuelve la cobertura.
 */
export function AttendancePage() {
  const user = useUser();
  const { entries, enqueue } = useSync();
  const { toast, confirm } = useFeedback();
  const [tab, setTab] = useState<'marcar' | 'historial'>('marcar');
  const [gps, setGps] = useState<GpsReading | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [busy, setBusy] = useState<PunchType | null>(null);
  const [selfieFor, setSelfieFor] = useState<PunchType | null>(null);
  const [selfie, setSelfie] = useState<PreparedPhoto | null>(null);
  const [mileage, setMileage] = useState('');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [support, setSupport] = useState<PreparedPhoto | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [, setTick] = useState(0);

  // Re-render por minuto: el panel de sustento aparece al pasar la tolerancia.
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const punchesQ = useQuery({ queryKey: ['hr', 'punches', todayIso()], queryFn: fetchTodayPunches });
  const routesQ = useQuery({ queryKey: ['hr', 'routes', todayIso()], queryFn: fetchRoutes });
  const sessionQ = useQuery({ queryKey: ['hr', 'session', todayIso()], queryFn: fetchWorkSession });
  // Maestro de rostros: el rostro registrado de ESTA sesión (varios empleados comparten celular).
  const faceQ = useQuery({ queryKey: ['hr', 'face', user.id], queryFn: fetchFaceEnrollment });
  const enrollment = faceQ.data?.value ?? null;
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [checkingFace, setCheckingFace] = useState(false);
  // Huella ya confirmada al tocar Marcar (se pide ANTES de la selfie).
  const [proof, setProof] = useState<{ type: PunchType; at: Date; clientUuid: string; webauthn: Record<string, string> | null } | null>(null);
  useEffect(() => {
    if (enrollment?.enrolled) preloadFaceModel();
  }, [enrollment?.enrolled]);
  // Huella: llave de ESTE usuario en ESTE celular, y vigente en el servidor.
  const localCred = useLiveQuery(() => db.device.get(`webauthn:${user.id}`), [user.id]);
  const credsQ = useQuery({ queryKey: ['hr', 'webauthn', user.id], queryFn: fetchOwnCredentials });
  const fingerprintReady = !!localCred && (credsQ.data ? credsQ.data.value.includes(localCred.credentialId) : true);
  const faceReady = !!enrollment?.enrolled;
  // La API de este ambiente aún no tiene huella/rostro: no se puede marcar desde la web móvil.
  const identityMissing = isRouteMissing(faceQ.error) || isRouteMissing(credsQ.error);

  const today = todayIso();
  const marks = useMemo(() => {
    const map = new Map<PunchType, Mark>();
    for (const p of punchesQ.data?.value ?? []) {
      if (p.date && p.date !== today) continue;
      const [h, m] = p.time.split(':').map(Number);
      const at = new Date();
      at.setHours(h || 0, m || 0, 0, 0);
      map.set(p.type, { type: p.type, at, synced: true, failed: false, gpsQuality: '' });
    }
    // Las de la cola (aún no confirmadas) se superponen.
    for (const e of entries) {
      if (e.kind !== 'marcacion' || !e.payload) continue;
      const at = new Date(String(e.payload.punched_at));
      if (todayIso(at) !== today) continue;
      const type = e.payload.type as PunchType;
      const meta = (e.payload.metadata ?? {}) as Record<string, unknown>;
      if (e.status === 'enviada' && map.has(type)) continue;
      map.set(type, { type, at, synced: e.status === 'enviada', failed: e.status === 'fallida', gpsQuality: String(meta.gps_quality ?? '') });
    }
    return map;
  }, [punchesQ.data, entries, today]);

  const marked = new Set(marks.keys());
  const route = routesQ.data?.value[0] ?? null;
  // Sin malla para hoy (consulta hecha, en linea o desde la copia local): no se puede marcar.
  const noMalla = !!routesQ.data && !route;
  const plate = route?.vehiclePlate?.trim() ?? '';
  const target: PunchType | null = !marked.has('entrada') ? 'entrada' : !marked.has('salida') ? 'salida' : null;
  const asksMileage = plate !== '' && target !== null;

  const now = new Date();
  const ref = target === 'entrada' ? minuteOfDay(route?.startTime ?? null) : minuteOfDay(route?.endTime ?? null);
  const outBy = route && target && ref !== null ? Math.max(0, now.getHours() * 60 + now.getMinutes() - ref - route.toleranceMinutes) : 0;
  const asksSupport = outBy > 0;

  const dayClosed = marked.has('salida');
  const sessionActive = !dayClosed && ((sessionQ.data?.value.active ?? false) || marked.has('entrada'));

  const activities: WorkActivity[] = useMemo(() => {
    const local = entries
      .filter((e) => e.kind === 'actividad' && e.status !== 'enviada' && e.payload)
      .map<WorkActivity>((e) => ({
        key: e.clientUuid,
        typeName: String(((e.payload!.metadata ?? {}) as Record<string, unknown>).activity_type_name ?? 'Actividad'),
        observation: String(e.payload!.observation ?? ''),
        occurredAt: String(e.payload!.occurred_at),
        synced: false,
      }));
    return [...local, ...(sessionQ.data?.value.activities ?? [])];
  }, [entries, sessionQ.data]);

  const activateGps = async () => {
    setGpsBusy(true);
    const r = await readLocation();
    setGps(r);
    setGpsBusy(false);
    toast(GPS_MESSAGES[r.outcome], r.outcome === 'fresh' ? 'ok' : r.outcome.startsWith('permission') || r.outcome === 'serviceDisabled' ? 'bad' : 'warn');
  };

  const alertNoMalla = () =>
    void confirm({
      title: 'No tienes malla registrada',
      message: 'No tienes malla (horario) asignada para hoy, así que no puedes marcar.\nComunícate con tu supervisor para que te la asigne.',
      confirm: 'Entendido',
      cancel: false,
    });

  // Al abrir la jornada sin malla, el aviso sale una sola vez.
  const [noMallaShown, setNoMallaShown] = useState(false);
  useEffect(() => {
    if (noMalla && !noMallaShown && tab === 'marcar') {
      setNoMallaShown(true);
      alertNoMalla();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noMalla, noMallaShown, tab]);

  const begin = (type: PunchType) => {
    if (busy || !isAvailable(type, marked) || marked.has(type)) return;
    if (noMalla) {
      alertNoMalla();
      return;
    }
    if (identityMissing) {
      toast(IDENTITY_NOT_ENABLED, 'warn');
      return;
    }
    // Para marcar se exigen las DOS pruebas: rostro registrado y huella en este celular.
    if (!faceReady) {
      toast('Para marcar, primero registra tu rostro (panel "Mi rostro").', 'warn');
      return;
    }
    if (fingerprintRequired && !fingerprintReady) {
      toast('Para marcar, primero registra tu huella en este celular (panel "Mi huella").', 'warn');
      return;
    }
    if (type === target && asksMileage && !MILEAGE_RE.test(mileage.trim().replace(',', '.'))) {
      toast('Registra el kilometraje: número positivo, un decimal como máximo.', 'bad');
      return;
    }
    if (type === target && asksSupport && (!reason || !detail.trim() || !support)) {
      toast('Fuera de tolerancia: elige motivo, escribe el sustento y adjunta la foto.', 'bad');
      return;
    }
    void confirmFingerprintThenSelfie(type);
  };

  // 1) HUELLA primero: firma usuario, tipo, hora e idempotencia. 2) Luego la selfie.
  const confirmFingerprintThenSelfie = async (type: PunchType) => {
    const at = new Date();
    const clientUuid = newClientUuid();
    let webauthn: Record<string, string> | null = null;
    if (fingerprintRequired && localCred) {
      setBusy(type);
      try {
        webauthn = { ...(await signPunchWithFingerprint({
          userId: user.id,
          credentialId: localCred.credentialId,
          rpId: localCred.rpId,
          type,
          punchedAt: at.toISOString(),
          idempotencyKey: clientUuid,
        })) };
      } catch (e) {
        toast(e instanceof Error ? e.message : 'No se confirmó la huella', 'bad');
        return;
      } finally {
        setBusy(null);
      }
    }
    const p = { type, at, clientUuid, webauthn };
    setProof(p);
    if (needsSelfie(type)) {
      setSelfie(null);
      setSelfieFor(type);
    } else {
      void punch(type, null, p);
    }
  };

  const punch = async (type: PunchType, face: PreparedPhoto | null, p = proof) => {
    // La huella se confirmó al tocar Marcar; si pasó mucho tiempo se vuelve a pedir.
    if (!p || p.type !== type || Date.now() - p.at.getTime() > 5 * 60_000) {
      toast('Pasaron más de 5 minutos desde tu huella. Vuelve a tocar Marcar.', 'warn');
      setProof(null);
      setSelfieFor(null);
      return;
    }
    setBusy(type);
    // Rostro registrado: la selfie debe ser de la persona de esta sesión. Se compara aquí,
    // al instante y sin señal; si no coincide se pide repetir y NO se marca.
    let faceCheck: FaceCheck | null = null;
    if (face && enrollment?.enrolled && enrollment.embedding) {
      setCheckingFace(true);
      faceCheck = await compareSelfie(enrollment.embedding, face.blob, enrollment.threshold);
      setCheckingFace(false);
      if (faceCheck.status !== 'coincide' && faceCheck.status !== 'no_disponible') {
        toast(FACE_MESSAGES[faceCheck.status], 'bad');
        setSelfie(null);
        setBusy(null);
        return;
      }
    }
    const { at, clientUuid, webauthn } = p;
    setSelfieFor(null);
    try {
      const reading = gps?.outcome === 'fresh' ? gps : await readLocation();
      setGps(reading);
      const uid = String(user.id);
      const selfieFile = face ? await storePhoto(face, uid) : null;
      const isTarget = type === target;
      const supportFile = isTarget && asksSupport && support ? await storePhoto(support, uid) : null;
      const km = mileage.trim().replace(',', '.');
      await enqueue([
        OutboxRequests.attendancePunch({
          type,
          userName: user.name,
          at,
          gpsQuality: gpsQuality(reading),
          clientUuid,
          fix: reading.fix,
          routeId: route?.id ?? null,
          vehiclePlate: plate || null,
          startMileageKm: isTarget && asksMileage && type === 'entrada' ? km : null,
          dayMileageKm: isTarget && asksMileage && type === 'salida' ? km : null,
          extraReason: isTarget && asksSupport ? reason : null,
          extraDetail: isTarget && asksSupport ? detail.trim() : null,
          selfieFileId: selfieFile?.id ?? null,
          extraEvidenceFileId: supportFile?.id ?? null,
          faceCheck: faceCheck ? { ...faceCheck } : null,
          webauthn,
        }),
      ]);
      setProof(null);
      const title = PUNCHES.find((p) => p.type === type)!.title;
      toast(
        reading.outcome === 'fresh'
          ? `${title} registrada. Se envía al servidor en cuanto haya señal.`
          : `${title} registrada sin GPS confirmado: quedará señalada para auditoría.`,
        reading.outcome === 'fresh' ? 'ok' : 'warn',
      );
      if (isTarget) {
        setMileage('');
        setReason('');
        setDetail('');
        setSupport(null);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No fue posible registrar la marcación', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const gpsLabel = gps?.outcome === 'fresh' ? 'GPS validado' : gps?.fix ? 'GPS aproximado' : 'Activar GPS';

  return (
    <div className="page-bg min-h-full pb-10">
      <ScreenHeader title="Control de horarios" />
      <SyncBanner />
      <div className="px-4 pt-4">
        <p className="text-xs font-bold tracking-wider text-teal uppercase">Marcación móvil</p>
        <h1 className="text-2xl font-extrabold">Mi jornada</h1>
        <p className="text-[13px] text-muted">Gestiona tus horarios y registra tus marcaciones fácilmente.</p>
        <div className="mt-3 grid grid-cols-2 rounded-[14px] border border-line bg-surface-alt p-1">
          {(['marcar', 'historial'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`min-h-10 rounded-[10px] text-sm font-bold ${tab === t ? 'bg-teal/15 text-teal' : 'text-muted'}`}>
              {t === 'marcar' ? 'Marcar' : 'Historial'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'historial' ? (
        <div className="space-y-2 p-4">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Hoy</p>
          {marks.size === 0 ? (
            <div className="py-10 text-center">
              <Icon name="fingerprint" size={40} className="mx-auto text-faint" />
              <p className="mt-2 font-semibold">Sin marcaciones hoy</p>
              <p className="text-sm text-muted">Tus marcaciones aparecerán aquí.</p>
            </div>
          ) : (
            [...marks.values()].sort((a, b) => b.at.getTime() - a.at.getTime()).map((m) => (
              <Panel key={m.type} className="flex items-center gap-3">
                <Icon name="fingerprint" className="text-teal" />
                <div className="flex-1">
                  <p className="font-semibold">{PUNCHES.find((p) => p.type === m.type)!.title}</p>
                  <p className="text-xs text-muted">{markStatus(m)}</p>
                </div>
                <span className="text-sm text-muted">{formatTime(m.at)}</span>
              </Panel>
            ))
          )}
          <div className="pt-3">
            <PunchHistory />
          </div>
        </div>
      ) : punchesQ.isLoading ? (
        <CenterSpinner />
      ) : (
        <div className="space-y-3 p-4">
          {punchesQ.data?.fromCache && <InfoBox tone="warn" icon="cloudOff">Sin conexión: se muestran las marcaciones guardadas en el teléfono.</InfoBox>}

          <Panel>
            <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Usuario conectado</p>
            <p className="text-lg font-bold">{user.name || 'Técnico'}</p>
            <p className={`text-[13px] ${gps?.outcome === 'fresh' ? 'text-teal' : 'text-warn'}`}>
              {gps?.outcome === 'fresh' ? 'GPS validado para marcar' : gps?.fix ? 'GPS aproximado: la marcación quedará señalada' : 'Sin GPS: puedes marcar y quedará señalada'}
            </p>
            <p className="mt-1.5 text-[12px] text-faint">
              {enrollment?.enrolled
                ? 'Tu identidad se verifica comparando cada selfie con tu rostro registrado.'
                : 'Marcación web: se valida con tu selfie. Registra tu rostro para verificar tu identidad.'}
            </p>
          </Panel>

          {identityMissing ? (
            <InfoBox tone="warn" icon="alert">{IDENTITY_NOT_ENABLED}</InfoBox>
          ) : (
            <>
              <FacePanel enrollment={enrollment} loading={faceQ.isLoading} onEnroll={() => setEnrollOpen(true)} />
              {fingerprintRequired && <FingerprintPanel ready={fingerprintReady} onRegistered={() => void credsQ.refetch()} />}
            </>
          )}

          <Panel>
            <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Horario asignado</p>
            {routesQ.isLoading ? (
              <p className="text-sm text-muted">Consultando tu horario...</p>
            ) : !route ? (
              <div className="mt-1">
                <InfoBox tone="bad" icon="alert">
                  <b>No tienes malla registrada para hoy.</b> No puedes marcar hasta que tu supervisor te asigne la malla. Si ya te la asignaron, revisa que sea para la fecha de hoy.
                </InfoBox>
              </div>
            ) : (
              <>
                <p className="font-bold">{route.startTime ? `${route.startTime}${route.endTime ? ` - ${route.endTime}` : ''}` : 'Horario asignado'}</p>
                <p className="text-[13px] text-muted">
                  {[plate && `Vehículo ${plate}`, `Tolerancia ${route.toleranceMinutes} min`].filter(Boolean).join(' · ')}
                </p>
              </>
            )}
          </Panel>

          {asksMileage && (
            <Panel>
              <p className="font-bold">{target === 'entrada' ? 'Kilometraje inicial del día' : 'Kilometraje recorrido del día'}</p>
              <p className="mb-2 text-[13px] text-muted">
                {target === 'entrada'
                  ? `Obligatorio para abrir jornada con ${plate}. Lectura del odómetro al recibir el vehículo.`
                  : `Obligatorio para cerrar jornada con ${plate}. Kilómetros recorridos, no odómetro final.`}
              </p>
              <div className="relative">
                <input className="field pr-12" inputMode="decimal" placeholder={target === 'entrada' ? 'Ej: 128430.5' : 'Ej: 42.5'} value={mileage} onChange={(e) => setMileage(e.target.value)} />
                <span className="absolute top-3.5 right-4 text-muted">km</span>
              </div>
            </Panel>
          )}

          <div className="space-y-2.5">
            {PUNCHES.map((p) => {
              const m = marks.get(p.type);
              const available = isAvailable(p.type, marked) && !m;
              return (
                <div key={p.type} className={`panel flex items-center gap-3 p-3.5 ${m ? 'border-teal-solid!' : ''}`}>
                  {m ? (
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ok/20 text-ok"><Icon name="check" size={24} /></span>
                  ) : available ? (
                    <GradientTile icon={p.icon} gradient={p.gradient} size={48} />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-high text-faint"><Icon name={p.icon} size={22} /></span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`font-bold ${!m && !available ? 'text-muted' : ''}`}>{p.title}</p>
                    <p className={`text-[12.5px] ${m ? (m.failed ? 'text-bad' : m.synced ? 'text-teal' : 'text-warn') : 'text-muted'}`}>
                      {m ? `Marcada ${formatTime(m.at)} · ${markStatus(m)}` : p.hint}
                    </p>
                  </div>
                  {!m && (
                    <button
                      type="button"
                      disabled={!available || busy !== null}
                      onClick={() => begin(p.type)}
                      aria-label={`Marcar ${p.title}`}
                      className="flex h-12 min-w-20 items-center justify-center rounded-[14px] bg-teal-solid px-3 text-sm font-bold text-white disabled:bg-surface-high disabled:text-faint"
                    >
                      {busy === p.type ? <span className="spinner h-5 w-5" /> : 'Marcar'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" onClick={() => void activateGps()} disabled={gpsBusy} className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-[14px] font-bold text-white ${gps?.outcome === 'fresh' ? 'grad-teal' : gps?.fix ? 'grad-amber' : 'grad-blue'}`}>
            {gpsBusy ? <span className="spinner h-5 w-5" /> : <Icon name="pin" size={18} />} {gpsLabel}
          </button>


          {asksSupport && (
            <Panel border="rgba(245,158,11,.5)">
              <p className="font-bold text-warn">{target === 'entrada' ? 'Llegada tarde detectada' : 'Extensión de horario detectada'}</p>
              <p className="mb-2.5 text-[13px] text-muted">
                Vas {outBy} min por fuera de la tolerancia de {route?.toleranceMinutes} min. Selecciona motivo, sustenta y adjunta foto.
              </p>
              <label className="mb-2 block">
                <span className="mb-1 block text-[13px] text-muted">{target === 'entrada' ? 'Motivo de la llegada tarde' : 'Motivo de extensión'}</span>
                <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {(target === 'entrada' ? LATE_REASONS : EXTENSION_REASONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <textarea className="field mb-2 resize-none" rows={3} placeholder={target === 'entrada' ? 'Qué pasó, a quién avisaste y desde dónde vienes' : 'Quién autorizó, punto, cliente o novedad'} value={detail} onChange={(e) => setDetail(e.target.value)} aria-label="Sustento" />
              <PhotoButton purpose="sustento" label="Foto de soporte (obligatoria)" value={support} onChange={setSupport} />
            </Panel>
          )}

          <Panel>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Estado operativo</p>
                <p className="font-bold">{sessionActive ? 'Jornada activa' : 'Sin jornada activa'}</p>
              </div>
              <span className="text-center text-xs text-muted"><b className="block text-lg text-ink">{activities.length}</b>{activities.length === 1 ? 'actividad' : 'actividades'}</span>
            </div>
            <p className="mt-1 text-[13px] text-muted">
              {sessionActive ? 'Registra cada actividad con foto para dejar trazabilidad de tu jornada.' : 'Marca Entrada para iniciar trazabilidad operativa.'}
            </p>
            <PrimaryButton className="mt-3" icon="task" disabled={!sessionActive} onClick={() => setActivityOpen(true)}>Registrar actividad</PrimaryButton>
            {!sessionActive && <p className="mt-1.5 text-center text-xs text-muted">{dayClosed ? 'La jornada ya se cerró con la salida.' : 'Disponible después de marcar Entrada.'}</p>}
            <div className="mt-3 space-y-2">
              {activities.map((a) => (
                <div key={a.key} className="flex items-start gap-2 text-[13px]">
                  <Icon name={a.synced ? 'task' : 'upload'} size={16} className={`mt-0.5 ${a.synced ? 'text-teal' : 'text-warn'}`} />
                  <span>
                    <b>{a.typeName}</b>{' '}
                    <span className="text-muted">
                      {[a.occurredAt && formatTime(new Date(a.occurredAt)), !a.synced && 'pendiente de enviar', a.observation].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <BottomSheet open={selfieFor !== null} onClose={() => { setSelfieFor(null); setProof(null); toast('Marcación cancelada: la foto de tu rostro es obligatoria.', 'warn'); }} title={PUNCHES.find((p) => p.type === selfieFor)?.title ?? ''}>
        <p className="mb-3 text-sm text-muted">Mira a la cámara. La foto queda en la marcación.</p>
        {selfie && <img src={selfie.previewUrl} alt="Selfie" className="mx-auto mb-3 h-48 w-48 rounded-2xl object-cover" />}
        <PhotoButton purpose="selfie" selfie label="Tomar selfie" retakeLabel="Repetir selfie" value={selfie} onChange={setSelfie} />
        {enrollment?.enrolled && (
          <p className="mt-2 text-center text-xs text-muted">
            {proof?.webauthn ? 'Huella confirmada ✓. Ahora tu selfie: ' : ''}se comparará con tu rostro registrado.
          </p>
        )}
        <PrimaryButton className="mt-3" icon="check" disabled={!selfie} busy={checkingFace} onClick={() => selfieFor && void punch(selfieFor, selfie)}>Registrar marcación</PrimaryButton>
      </BottomSheet>

      {enrollOpen && enrollment && <FaceEnrollSheet enrollment={enrollment} onClose={() => setEnrollOpen(false)} />}

      <ActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} gps={gps} onGps={setGps} />
    </div>
  );
}

function markStatus(m: Mark): string {
  if (m.failed) return 'No se pudo enviar';
  if (m.synced) return 'Registrada';
  return `${GPS_LABEL[m.gpsQuality] ?? 'Sin GPS'} · por enviar`;
}

function ActivitySheet({ open, onClose, gps, onGps }: { open: boolean; onClose: () => void; gps: GpsReading | null; onGps: (g: GpsReading) => void }) {
  const user = useUser();
  const { enqueue } = useSync();
  const { toast } = useFeedback();
  const typesQ = useQuery({ queryKey: ['hr', 'activity-types'], queryFn: fetchActivityTypes, enabled: open });
  const types = useMemo(() => typesQ.data?.value ?? [], [typesQ.data]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [obs, setObs] = useState('');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (types.length === 1) setTypeId(types[0].id);
  }, [types]);

  const save = async () => {
    const t = types.find((x) => x.id === typeId);
    if (!t || !photo) return;
    setSaving(true);
    try {
      const reading = gps?.outcome === 'fresh' ? gps : await readLocation();
      onGps(reading);
      const f = await storePhoto(photo, String(user.id));
      await enqueue([
        OutboxRequests.workActivity({
          activityTypeId: t.id, activityTypeCode: t.code, activityTypeName: t.name, userName: user.name, at: new Date(),
          fileId: f.id, gpsQuality: gpsQuality(reading), observation: obs.trim(), fix: reading.fix,
        }),
      ]);
      toast('Actividad registrada. Se envía al servidor en cuanto haya señal.', 'ok');
      setObs('');
      setPhoto(null);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No fue posible registrar la actividad', 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Registrar actividad">
      {typesQ.isLoading ? (
        <CenterSpinner />
      ) : types.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No hay tipos de actividad configurados. Pídelos a administración.</p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[13px] text-muted">Tipo de actividad</span>
            <select className="field" value={typeId ?? ''} onChange={(e) => setTypeId(Number(e.target.value) || null)}>
              <option value="">Selecciona…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <textarea className="field resize-none" rows={3} placeholder="Observación (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} />
          <PhotoButton purpose="actividad" label="Foto de evidencia (obligatoria)" value={photo} onChange={setPhoto} />
          <PrimaryButton disabled={!typeId || !photo} busy={saving} onClick={() => void save()}>Guardar actividad</PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );
}

/** Estado del rostro registrado del empleado de esta sesión. */
function FacePanel({ enrollment, loading, onEnroll }: { enrollment: FaceEnrollment | null; loading: boolean; onEnroll: () => void }) {
  if (loading) return null;
  if (!enrollment) {
    return (
      <Panel>
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Mi rostro</p>
        <p className="text-[13px] text-muted">Conéctate a internet para consultar o registrar tu rostro.</p>
      </Panel>
    );
  }
  return enrollment.enrolled ? (
    <Panel className="flex items-center gap-3">
      <GradientTile icon="user" gradient="teal" size={44} />
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Mi rostro</p>
        <p className="font-bold text-teal">Rostro registrado</p>
        <p className="text-[12.5px] text-muted">
          {enrollment.enrolledAt ? `Desde ${new Date(enrollment.enrolledAt).toLocaleDateString('es-CO')}. ` : ''}Cada selfie se compara con tu rostro. Para cambiarlo, pide a talento humano que lo restablezca.
        </p>
      </div>
    </Panel>
  ) : (
    <Panel border="rgba(245,158,11,.5)">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Mi rostro</p>
      <p className="font-bold">Registra tu rostro</p>
      <p className="mb-3 text-[13px] text-muted">
        Si varias personas marcan en este celular, tu rostro es lo que prueba que la marcación es tuya. Se registra una sola vez.
      </p>
      <PrimaryButton icon="user" onClick={onEnroll}>Registrar mi rostro</PrimaryButton>
    </Panel>
  );
}

/** Registro del rostro: autorización de datos biométricos + foto + verificación. */
function FaceEnrollSheet({ enrollment, onClose }: { enrollment: FaceEnrollment; onClose: () => void }) {
  const { toast } = useFeedback();
  const qc = useQueryClient();
  const user = useUser();
  const [accepted, setAccepted] = useState(false);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!photo || !accepted) return;
    if (!navigator.onLine) {
      toast('Necesitas conexión para registrar tu rostro la primera vez.', 'warn');
      return;
    }
    setBusy(true);
    try {
      const check = await checkEnrollmentPhoto(photo.blob);
      if (!check.ok) {
        toast(check.message, 'bad');
        setPhoto(null);
        return;
      }
      await enrollFace({ photo, consentVersion: enrollment.consentVersion, clientCheck: { antispoof: check.antispoof, liveness: check.liveness } });
      await qc.invalidateQueries({ queryKey: ['hr', 'face', user.id] });
      toast('Rostro registrado. Desde ahora cada selfie se compara con tu rostro.', 'ok');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No fue posible registrar el rostro', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title="Registrar mi rostro">
      <div className="space-y-3">
        <div className="max-h-56 overflow-y-auto rounded-[14px] border border-line bg-surface-alt p-3 text-[12.5px] leading-relaxed whitespace-pre-line text-muted">
          <p className="mb-2 font-bold text-ink">Autorización de tratamiento de datos biométricos</p>
          {enrollment.consentText || 'Conéctate para ver el texto de la autorización.'}
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-teal-500" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>He leído y <b>autorizo</b> el tratamiento de la imagen de mi rostro para verificar mi identidad al marcar jornada.</span>
        </label>
        <p className="text-sm text-muted">Foto de frente, con buena luz, sin gafas oscuras ni gorra, y solo tú en la imagen.</p>
        {photo && <img src={photo.previewUrl} alt="Tu rostro" className="mx-auto h-48 w-48 rounded-2xl object-cover" />}
        <PhotoButton purpose="rostro" selfie label="Tomar foto de mi rostro" retakeLabel="Repetir foto" value={photo} onChange={setPhoto} />
        <PrimaryButton icon="check" disabled={!photo || !accepted || !enrollment.consentVersion} busy={busy} onClick={() => void submit()}>
          Registrar rostro
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}

/** Huella del empleado de esta sesión en ESTE celular (llave WebAuthn). */
function FingerprintPanel({ ready, onRegistered }: { ready: boolean; onRegistered: () => void }) {
  const user = useUser();
  const { toast } = useFeedback();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void platformAuthenticatorAvailable().then(setAvailable);
  }, []);
  // El lector del telefono acepta cualquier dedo inscrito en el: si otra persona ya registro
  // su huella en este celular, se avisa (decision del dueno: solo huella, un celular por persona).
  const [others, setOthers] = useState<string[]>([]);
  useEffect(() => {
    void quickLoginUsers().then((list) => setOthers(list.filter((q) => q.userId !== user.id).map((q) => q.name))).catch(() => setOthers([]));
  }, [user.id, ready]);
  const sharedWarning = others.length > 0 && (
    <InfoBox tone="warn" icon="alert">
      Este celular también tiene la huella de <b>{others.join(', ')}</b>. El lector acepta cualquier dedo guardado en el teléfono y no sabe de quién es: con un dedo inscrito se puede entrar con el usuario de otra persona. Lo recomendado es que cada persona use su propio celular, o que en este solo esté inscrito el dedo de una persona.
    </InfoBox>
  );

  const register = async () => {
    if (!navigator.onLine) {
      toast('Necesitas conexión para registrar tu huella la primera vez.', 'warn');
      return;
    }
    setBusy(true);
    try {
      await registerFingerprint({ id: user.id, email: user.email, name: user.name, tenantId: user.tenantId });
      onRegistered();
      toast('Huella registrada en este celular. Desde ahora cada marcación la pide.', 'ok');
    } catch (e) {
      toast(isRouteMissing(e) ? IDENTITY_NOT_ENABLED : e instanceof Error ? e.message : 'No fue posible registrar la huella', 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (ready) {
    return (
      <>
        <Panel className="flex items-center gap-3">
          <GradientTile icon="fingerprint" gradient="teal" size={44} />
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Mi huella</p>
            <p className="font-bold text-teal">Huella registrada en este celular</p>
            <p className="text-[12.5px] text-muted">Al marcar se pide primero tu huella y luego tu selfie.</p>
          </div>
        </Panel>
        {sharedWarning}
      </>
    );
  }
  return (
    <Panel border="rgba(245,158,11,.5)">
      {sharedWarning && <div className="mb-3">{sharedWarning}</div>}
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Mi huella</p>
      <p className="font-bold">Registra tu huella en este celular</p>
      <p className="mb-3 text-[13px] text-muted">
        Para marcar se pide primero tu huella y luego tu selfie. El celular te pedirá la huella para crear tu llave; cada persona registra la suya con su usuario.
      </p>
      {available === false ? (
        <InfoBox tone="warn" icon="alert">
          Este navegador no puede usar la huella. Abre la app desde su dirección HTTPS (no por IP) en Chrome o Safari, con huella o bloqueo de pantalla configurado en el teléfono.
        </InfoBox>
      ) : (
        <PrimaryButton icon="fingerprint" busy={busy} disabled={available === null} onClick={() => void register()}>
          Registrar mi huella
        </PrimaryButton>
      )}
    </Panel>
  );
}
