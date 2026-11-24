/**
 * Identificador de una operación del técnico, generado en el teléfono.
 * Viaja como `Idempotency-Key` y en el cuerpo (`client_upload_id`,
 * `idempotency_key`, `metadata.client_uuid`) según la operación.
 */
export function newClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Respaldo para contextos no seguros (http en LAN durante desarrollo).
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
