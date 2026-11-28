import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Carpeta del proyecto: los .env se leen de aquí aunque Vite se lance desde otra ruta.
const projectDir = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectDir, '');
  // A dónde reenvía /api el servidor de desarrollo (y `vite preview`).
  // Por defecto QA: probar contra producción crearía datos reales.
  const apiTarget = env.APEXOS_API_TARGET || 'https://apexos-api-qa-production.up.railway.app';

  return {
    root: projectDir,
    envDir: projectDir,
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [
      // DEV_HTTPS=true: certificado propio para abrir desde el celular por la red
      // local con HTTPS (el GPS y la cámara del navegador lo exigen).
      ...(process.env.DEV_HTTPS === 'true' ? [basicSsl()] : []),
      react(),
      tailwindcss(),
      VitePWA({
        // 'prompt' + registro propio (src/core/appUpdate.ts): al abrir se actualiza sola; con la
        // app abierta se revisa cada 15 min y se ofrece "Actualizar" sin recargar a mitad de algo.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
        manifest: {
          name: 'APEXOS Web Móvil',
          short_name: 'APEXOS',
          description: 'APEXOS - servicios en campo para técnicos',
          lang: 'es-CO',
          start_url: '/inicio',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#071320',
          theme_color: '#071320',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // La app (HTML/JS/CSS/íconos) queda en caché: abre sin internet.
          // Incluye los modelos del maestro de rostros: la comparación funciona sin señal.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}', 'models/**/*.{json,bin}'],
          // faceres.bin (~7 MB) y el motor de reconocimiento superan el tope por defecto (2 MB).
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          // La API NUNCA se cachea en el Service Worker: los datos offline
          // viven en IndexedDB con control explícito (usuario, vigencia).
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          // Sin skipWaiting: la versión nueva espera a que la app la aplique (al abrir, sola;
          // con la app en uso, con el botón "Actualizar"). Ver src/core/appUpdate.ts.
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      host: true,
      // Tunel HTTPS temporal (cloudflared) para probar la huella real desde un celular.
      allowedHosts: ['.trycloudflare.com'],
      proxy: { '/api': { target: apiTarget, changeOrigin: true, secure: true } },
    },
    preview: {
      host: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: true, secure: true } },
    },
    build: { target: 'es2020', sourcemap: false },
  };
});
