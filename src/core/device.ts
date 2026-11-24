/**
 * Detección de celular. Es una restricción de INTERFAZ, no de seguridad: un
 * usuario puede falsear el user-agent. La seguridad real está en la API.
 *
 * Se considera celular si:
 *  - el user-agent declara un móvil (Android Mobile, iPhone, iPod), o
 *  - `navigator.userAgentData.mobile === true` (Chrome), o
 *  - el puntero principal es táctil ("coarse") y la pantalla es angosta.
 * Las tabletas (iPad, Android sin "Mobile") quedan fuera.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return true;
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile === true) return true;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = Math.min(window.screen.width, window.screen.height) <= 500;
  return coarse && narrow;
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return /iPhone|iPod|iPad/i.test(navigator.userAgent);
}
