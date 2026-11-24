import { describe, expect, it } from 'vitest';
import { OutboxRequests } from '../sync/outboxRequests';
import { b64urlToBytes, bytesToB64url, challengeFor, personalPunchMessage } from './webauthn';

describe('huella propia (WebAuthn) en el celular', () => {
  const msg = personalPunchMessage({
    userId: 7,
    type: 'entrada',
    punchedAt: '2026-11-22T14:00:00.000Z',
    idempotencyKey: 'uuid-web-0001',
    credentialId: 'cred-abc_123-XYZ',
  });

  it('el mensaje firmado (huella primero, sin selfie) es EXACTAMENTE el del servidor', () => {
    expect(msg).toBe('apexos-web-punch|v2|7|entrada|2026-11-22T14:00:00.000Z|uuid-web-0001|cred-abc_123-XYZ');
  });

  it('el reto es el mismo que calcula el servidor (challengeForMessage)', async () => {
    // Vector obtenido con apps/api/src/modules/hr/shared-device-identity.js para este mensaje.
    expect(bytesToB64url(await challengeFor(msg))).toBe('QBJ-jIATfy5rgs8FxC19am-xs6oljLdUNub1Q9KTHWw');
  });

  it('base64url ida y vuelta', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 250, 1, 2]);
    expect([...b64urlToBytes(bytesToB64url(bytes))]).toEqual([...bytes]);
  });

  it('la marcación lleva la firma de la huella y el resultado del rostro en metadata', () => {
    const d = OutboxRequests.attendancePunch({
      type: 'entrada',
      userName: 'Técnico',
      at: new Date('2026-11-22T14:00:00.000Z'),
      gpsQuality: 'sin_gps',
      clientUuid: 'uuid-web-0001',
      selfieFileId: 'f1',
      faceCheck: { status: 'coincide', similarity: 0.84 },
      webauthn: { credential_id: 'c', authenticator_data: 'a', client_data_json: 'j', signature: 's' },
    });
    expect(d.payload).toMatchObject({
      punched_at: '2026-11-22T14:00:00.000Z',
      idempotency_key: 'uuid-web-0001',
      metadata: { face_check: { status: 'coincide' }, webauthn: { signature: 's' } },
    });
  });
});
