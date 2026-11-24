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

describe('API sin las rutas de huella y rostro', () => {
  it('reconoce el 404 de Fastify «Route … not found» y no otros 404', async () => {
    const { ApiException, isRouteMissing } = await import('../services/apiClient');
    expect(isRouteMissing(new ApiException('Route POST:/api/v1/hr/self/webauthn/registration-challenge not found', 404))).toBe(true);
    expect(isRouteMissing(new ApiException('Empleado no encontrado', 404, 'EMPLEADO_NO_ENCONTRADO'))).toBe(false);
    expect(isRouteMissing(new ApiException('Route GET:/api/v1/hr/self/face-enrollment not found', 500))).toBe(false);
    expect(isRouteMissing(new Error('Route GET:/x not found'))).toBe(false);
  });
});
