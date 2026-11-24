/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_APEXOS_ENV?: string;
  readonly VITE_ALLOW_DESKTOP?: string;
  readonly VITE_LUNCH_SELFIE_REQUIRED?: string;
  readonly VITE_REQUIRE_FINGERPRINT?: string;
}
