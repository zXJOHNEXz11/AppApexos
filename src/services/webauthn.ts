import { Api } from '../config/endpoints';
import { asMap, asMapList, asString } from '../core/json';
import { db } from '../storage/db';
import { cachedFetch } from '../storage/cache';
import { api, canUseCache } from './apiClient';

/**
 * Huella del empleado para marcar (WebAuthn, llave de acceso de plataforma ES256).
 *
 * Cada empleado registra CON SU USUARIO una llave en este celular; el teléfono la
 * desbloquea con la huella. Cada marcación va firmada con esa llave. Junto con el
 * rostro: la huella firma (celular + llave del usuario) y el rostro prueba la persona,
 * porque el lector del teléfono acepta cualquier huella inscrita en él.
 *
 * Orden al marcar: PRIMERO la huella (firma usuario, tipo, hora, idempotencia y llave) y
 * DESPUÉS la selfie, que la valida el rostro registrado. El reto es sha256 del mensaje
 * canónico (igual que apps/api/src/modules/hr/personal-webauthn.js): se firma SIN SEÑAL.
 */

/** Exigir huella además del rostro (por defecto sí). */
export const fingerprintRequired = import.meta.env.VITE_REQUIRE_FINGERPRINT !== 'false';

export function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const s = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const toB64 = (b: ArrayBuffer) => {
  const u = bytesToB64url(b).replace(/-/g, '+').replace(/_/g, '/');
  return u + '='.repeat((4 - (u.length % 4)) % 4);
};

async function sha256(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export async function sha256Hex(blob: Blob): Promise<string> {
  return [...(await sha256(await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cadena firmada: debe coincidir EXACTAMENTE con personalPunchMessage del servidor. */
export function personalPunchMessage(p: {
  userId: number;
  type: string;
  punchedAt: string;
  idempotencyKey: string;
  credentialId: string;
}): string {
  return ['apexos-web-punch', 'v2', String(p.userId), p.type, p.punchedAt, p.idempotencyKey, p.credentialId].join('|');
}

export async function challengeFor(message: string): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(new TextEncoder().encode(message));
}

/** WebAuthn exige un dominio HTTPS: no funciona entrando por IP. */
export function hostSupportsWebauthn(hostname = window.location.hostname): boolean {
  return window.isSecureContext && (hostname === 'localhost' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname));
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return hostSupportsWebauthn() && typeof PublicKeyCredential !== 'undefined' && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

function webauthnError(e: unknown, action: string): Error {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') return new Error(`${action} cancelado: no se confirmó la huella.`);
  if (name === 'InvalidStateError') return new Error('Este celular ya tiene tu huella registrada.');
  if (name === 'SecurityError') return new Error('El navegador bloqueó la huella: abre la app desde su dominio HTTPS (no por IP).');
  if (name === 'NotSupportedError') return new Error('Este celular no permite usar la huella en el navegador.');
  return e instanceof Error ? e : new Error(`No fue posible: ${action}.`);
}

/* ---- llave registrada EN ESTE CELULAR para cada usuario (no es dato biométrico) ---- */

const localKey = (userId: number) => `webauthn:${userId}`;

export async function localCredential(userId: number): Promise<{ credentialId: string; rpId: string } | null> {
  const row = await db.device.get(localKey(userId));
  return row ? { credentialId: row.credentialId, rpId: row.rpId } : null;
}

/** Llaves activas del usuario en el servidor (para saber si la de este celular sigue vigente). */
export const fetchOwnCredentials = () =>
  cachedFetch(
    'hr:webauthn',
    async () => asMapList(asMap(await api.get(Api.hrWebauthn)).credentials).map((c) => asString(c.credential_id)),
    canUseCache,
  );

/* ---- ingreso con huella: personas que registraron su huella en ESTE celular ---- */

interface KeyOwner {
  id: number;
  email: string;
  name: string;
  tenantId: string;
}

export interface QuickLoginUser {
  userId: number;
  name: string;
  email: string;
  tenantId: string;
  credentialId: string;
  rpId: string;
}

/** Botones del login: llaves de este celular para este dominio (la llave solo sirve en él). */
export async function quickLoginUsers(hostname = window.location.hostname): Promise<QuickLoginUser[]> {
  const rows = await db.device.where('key').startsWith('webauthn:').toArray();
  return rows
    .filter((r) => r.credentialId && r.tenantId && r.userId && r.rpId === hostname)
    .map((r) => ({ userId: r.userId!, name: r.userName || r.email || `Usuario ${r.userId}`, email: r.email || '', tenantId: r.tenantId!, credentialId: r.credentialId, rpId: r.rpId }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Completa nombre y empresa de una llave ya registrada (p. ej. registrada antes de existir el ingreso con huella). */
export async function rememberQuickLogin(user: KeyOwner): Promise<void> {
  const row = await db.device.get(localKey(user.id));
  if (!row || !user.tenantId) return;
  if (row.userId === user.id && row.userName === user.name && row.email === user.email && row.tenantId === user.tenantId) return;
  await db.device.put({ ...row, userId: user.id, userName: user.name, email: user.email, tenantId: user.tenantId });
}

/** Quita el botón de una persona (su llave ya no es válida en el servidor). */
export async function forgetQuickLogin(userId: number): Promise<void> {
  await db.device.delete(localKey(userId));
}

/** Pide la huella y firma un reto con la llave indicada. */
async function assertWithFingerprint(p: { challenge: Uint8Array<ArrayBuffer>; credentialId: string; rpId: string; action: string }): Promise<WebauthnProof> {
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: p.challenge,
        rpId: p.rpId,
        allowCredentials: [{ type: 'public-key', id: b64urlToBytes(p.credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw webauthnError(e, p.action);
  }
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    credential_id: p.credentialId,
    authenticator_data: bytesToB64url(r.authenticatorData),
    client_data_json: bytesToB64url(r.clientDataJSON),
    signature: bytesToB64url(r.signature),
  };
}

/** Firma el reto de ingreso que entregó el servidor (requiere señal). */
export function signLoginWithFingerprint(q: QuickLoginUser, challengeB64url: string): Promise<WebauthnProof> {
  return assertWithFingerprint({ challenge: b64urlToBytes(challengeB64url), credentialId: q.credentialId, rpId: q.rpId, action: 'Ingreso' });
}

/** Registra la huella del usuario conectado en ESTE celular. */
export async function registerFingerprint(user: KeyOwner): Promise<void> {
  const ch = asString(asMap(await api.post(`${Api.hrWebauthn}/registration-challenge`)).challenge);
  if (!ch) throw new Error('El servidor no entregó el reto de registro.');
  const rpId = window.location.hostname;
  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        rp: { id: rpId, name: 'APEXOS' },
        user: { id: new TextEncoder().encode(`apexos-${user.id}`), name: user.email || `usuario-${user.id}`, displayName: user.name || user.email },
        challenge: b64urlToBytes(ch),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        attestation: 'none',
        timeout: 90_000,
      },
    })) as PublicKeyCredential;
  } catch (e) {
    throw webauthnError(e, 'Registro de huella');
  }
  const resp = cred.response as AuthenticatorAttestationResponse;
  const spki = resp.getPublicKey?.();
  if (!spki) throw new Error('Este navegador no entrega la llave pública. Actualiza Chrome o Safari.');
  const credentialId = bytesToB64url(cred.rawId);
  await api.post(Api.hrWebauthn, {
    credential_id: credentialId,
    public_key: toB64(spki),
    public_key_algorithm: resp.getPublicKeyAlgorithm(),
    client_data_json: bytesToB64url(resp.clientDataJSON),
    authenticator_data: bytesToB64url(resp.getAuthenticatorData()),
    rp_id: rpId,
    device_label: navigator.userAgent.slice(0, 120),
  });
  await db.device.put({
    key: localKey(user.id), deviceId: '', credentialId, plate: '', label: null, rpId, registeredAt: Date.now(),
    userId: user.id, userName: user.name, email: user.email, tenantId: user.tenantId,
  });
}

export interface WebauthnProof {
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}

/** Pide la huella y firma la marcación. Funciona sin señal. */
export async function signPunchWithFingerprint(p: {
  userId: number;
  credentialId: string;
  rpId: string;
  type: string;
  punchedAt: string;
  idempotencyKey: string;
}): Promise<WebauthnProof> {
  const challenge = await challengeFor(personalPunchMessage(p));
  return assertWithFingerprint({ challenge, credentialId: p.credentialId, rpId: p.rpId, action: 'Marcación' });
}
