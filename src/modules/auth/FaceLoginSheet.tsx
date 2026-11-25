import { useEffect, useRef, useState } from 'react';
import { BottomSheet, useFeedback } from '../../components/feedback';
import { PhotoButton } from '../../components/media';
import { InfoBox, PrimaryButton } from '../../components/ui';
import { compareSelfie, FACE_MESSAGES, preloadFaceModel } from '../../services/face';
import type { PreparedPhoto } from '../../services/media';
import { fetchFaceEnrollmentFresh } from '../attendance/faceApi';
import type { AppUser } from './user';

interface Pending {
  user: AppUser;
  embedding: number[];
  threshold: number;
  resolve: (ok: boolean) => void;
}

/**
 * Segundo paso del ingreso con huella: la selfie se compara con el rostro registrado del
 * usuario de ESA huella. El lector del teléfono acepta cualquier dedo inscrito en él; el
 * rostro es lo que distingue a dos personas que comparten celular.
 *
 * Devuelve `verifyFace(user)`: una promesa que se resuelve en true solo si el rostro
 * coincide. Si la persona cierra la hoja, se resuelve en false (el ingreso se cancela).
 */
export function useFaceLogin() {
  const [pending, setPending] = useState<Pending | null>(null);
  const { toast } = useFeedback();
  const [selfie, setSelfie] = useState<PreparedPhoto | null>(null);
  const [checking, setChecking] = useState(false);
  const resolved = useRef(false);

  useEffect(() => {
    // El modelo de rostro se carga mientras la persona pone la huella.
    preloadFaceModel();
  }, []);

  const verifyFace = async (user: AppUser): Promise<boolean> => {
    const enrollment = await fetchFaceEnrollmentFresh();
    if (!enrollment.enrolled || !enrollment.embedding?.length) {
      throw new Error('Para entrar con huella primero registra tu rostro en Mi jornada. Mientras tanto entra con tu correo y clave.');
    }
    return new Promise<boolean>((resolve) => {
      resolved.current = false;
      setSelfie(null);
      setPending({ user, embedding: enrollment.embedding!, threshold: enrollment.threshold, resolve });
    });
  };

  const finish = (ok: boolean) => {
    if (!pending || resolved.current) return;
    resolved.current = true;
    pending.resolve(ok);
    setPending(null);
    setSelfie(null);
  };

  const verify = async () => {
    if (!pending || !selfie) return;
    setChecking(true);
    try {
      const check = await compareSelfie(pending.embedding, selfie.blob, pending.threshold);
      if (check.status === 'coincide') {
        finish(true);
        return;
      }
      if (check.status === 'no_disponible') {
        toast('No se pudo verificar tu rostro en este celular. Entra con tu correo y clave.', 'bad');
        finish(false);
        return;
      }
      setSelfie(null);
      toast(check.status === 'no_coincide' ? `El rostro no coincide con el de ${pending.user.name || 'este usuario'}. Debe tomarse la selfie la persona dueña de la cuenta.` : FACE_MESSAGES[check.status], 'bad');
    } finally {
      setChecking(false);
    }
  };

  const sheet = (
    <BottomSheet open={pending !== null} onClose={() => finish(false)} title="Confirma que eres tú">
      {pending && (
        <div className="space-y-3">
          <p className="text-[13.5px] text-muted">
            Huella confirmada ✓. Ahora tómate una selfie: se compara con el rostro registrado de <b>{pending.user.name || pending.user.email}</b>.
          </p>
          <InfoBox tone="info" icon="info">
            En un celular compartido la huella no dice de quién es el dedo; el rostro sí. Si no eres esta persona, cierra y entra con tu propio usuario.
          </InfoBox>
          <PhotoButton purpose="selfie" selfie allowGallery={false} label="Tomar selfie" retakeLabel="Repetir selfie" value={selfie} onChange={setSelfie} />
          <PrimaryButton icon="check" disabled={!selfie} busy={checking} onClick={() => void verify()}>
            Entrar
          </PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );

  return { verifyFace, sheet };
}
