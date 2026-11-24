/**
 * Espera antes del próximo intento (port de `core/outbox/backoff.dart`).
 * Corta al principio (túnel, ascensor) y larga después (zona sin cobertura).
 * `attempts` = intentos que YA fallaron.
 */
const CURVE_MS = [5_000, 15_000, 45_000, 120_000, 300_000, 900_000, 1_800_000];

export function backoffFor(attempts: number): number {
  if (attempts <= 0) return 0;
  if (attempts > CURVE_MS.length) return 1_800_000;
  return CURVE_MS[attempts - 1];
}

/** Tras estos fallos seguidos queda `fallida` y la decide el técnico. */
export const MAX_AUTO_ATTEMPTS = 8;
