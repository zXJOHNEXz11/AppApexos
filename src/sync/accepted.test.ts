import { describe, expect, it } from 'vitest';
import { ApiException } from '../services/apiClient';
import { assertAccepted } from './sender';

describe('respuestas {ok:false} de la API', () => {
  it('checklist preoperacional pendiente NO se da por enviada', () => {
    expect(() => assertAccepted({ ok: false, preoperational_required: true, message: 'Checklist preoperacional obligatorio antes de iniciar jornada.' }))
      .toThrowError(ApiException);
    try {
      assertAccepted({ ok: false, preoperational_required: true });
    } catch (e) {
      expect((e as ApiException).code).toBe('PREOPERACIONAL_REQUERIDO');
      expect((e as ApiException).isRetryable).toBe(false);
    }
  });

  it('las respuestas normales pasan intactas', () => {
    expect(assertAccepted({ ok: true, replayed: true })).toEqual({ ok: true, replayed: true });
    expect(assertAccepted({ data: { id: 1 } })).toEqual({ data: { id: 1 } });
    expect(assertAccepted(null)).toBeNull();
  });
});
