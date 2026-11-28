import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_THRESHOLD, FACE_MESSAGES, FACE_MODEL, similarity } from './face';

describe('maestro de rostros (celular)', () => {
  const A = Array.from({ length: 8 }, (_, i) => (i % 2 ? 1 : 0.5));
  const B = Array.from({ length: 8 }, (_, i) => (i % 2 ? -1 : 0.7));

  it('la similitud es la MISMA fórmula coseno del servidor (face-identity.js)', () => {
    // Valores calculados con apps/api/src/modules/hr/face-identity.js para estos vectores.
    expect(similarity(A, A)).toBeCloseTo(1, 10);
    expect(similarity(A, B)).toBeCloseTo(-0.4762831485407526, 12);
    expect(similarity(A, [1, 2])).toBe(0);
    expect(similarity(null, A)).toBe(0);
  });

  it('modelo y umbral coinciden con el servidor', () => {
    expect(FACE_MODEL).toBe('human-3.3.6/faceres-1024');
    expect(DEFAULT_MATCH_THRESHOLD).toBe(0.55);
  });

  it('cada resultado que bloquea tiene un mensaje claro para el empleado', () => {
    expect(FACE_MESSAGES.no_coincide).toMatch(/no coincide/);
    expect(FACE_MESSAGES.sin_rostro).toMatch(/rostro/);
    expect(FACE_MESSAGES.varios_rostros).toMatch(/más de una persona/);
  });
});

describe('mínimo de coincidencia tolerante a cámaras de baja calidad', () => {
  it('el celular usa 0.45 aunque el servidor mande 0.55, y nunca es más estricto que el servidor', async () => {
    const { APP_MATCH_THRESHOLD, effectiveThreshold } = await import('./face');
    expect(APP_MATCH_THRESHOLD).toBe(0.45);
    expect(effectiveThreshold(0.55)).toBe(0.45);
    expect(effectiveThreshold(0.4)).toBe(0.4);
    expect(effectiveThreshold(0)).toBe(0.45);
  });
});
