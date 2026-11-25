import { Api } from '../../config/endpoints';
import { asDouble, asMap, asString, asStringOrNull } from '../../core/json';
import { api, canUseCache } from '../../services/apiClient';
import { blobToBase64 } from '../../sync/sender';
import { cachedFetch } from '../../storage/cache';
import { DEFAULT_MATCH_THRESHOLD } from '../../services/face';
import type { PreparedPhoto } from '../../services/media';

/**
 * Rostro registrado del empleado conectado. Se guarda en la caché POR USUARIO, que se
 * borra al cerrar sesión: en un celular compartido el dato biométrico de uno no queda
 * disponible para el siguiente que entre.
 */
export interface FaceEnrollment {
  enrolled: boolean;
  enrolledAt: string | null;
  embedding: number[] | null;
  threshold: number;
  consentVersion: string;
  consentText: string;
}

function parse(m: Record<string, unknown>): FaceEnrollment {
  const consent = asMap(m.consent);
  return {
    enrolled: m.enrolled === true,
    enrolledAt: asStringOrNull(m.enrolled_at),
    embedding: Array.isArray(m.embedding) ? (m.embedding as unknown[]).map((v) => Number(v)) : null,
    threshold: asDouble(m.match_threshold, DEFAULT_MATCH_THRESHOLD),
    consentVersion: asString(consent.version),
    consentText: asString(consent.text),
  };
}

export const fetchFaceEnrollment = () =>
  cachedFetch('hr:face-enrollment', async () => parse(asMap(await api.get(Api.hrFaceEnrollment))), canUseCache);

export async function enrollFace(p: { photo: PreparedPhoto; consentVersion: string; clientCheck: Record<string, unknown> }) {
  const base64 = `data:${p.photo.mime};base64,${await blobToBase64(p.photo.blob)}`;
  return asMap(
    await api.post(Api.hrFaceEnrollment, {
      consent_accepted: true,
      consent_version: p.consentVersion,
      photo: { base64, name: p.photo.name, type: p.photo.mime, size: p.photo.size },
      client_check: p.clientCheck,
    }),
  );
}
