# APEXOS Web Móvil

Versión web (PWA) de la app de campo APEXOS, **exclusiva para celulares** (Chrome en Android, Safari
en iPhone), sin instalar APK. Proyecto **independiente**: la app Flutter original no se modificó;
solo se usó como referencia (ver [docs/INVENTARIO.md](docs/INVENTARIO.md)).

**Stack:** React 19 + TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, Dexie
(IndexedDB), vite-plugin-pwa (Service Worker/Workbox).

## Funciones
- Login (API + respaldo Supabase, igual que Flutter), sesión cifrada, expiración → login.
- Órdenes de servicio: lista, detalle, inicio, inspección por piezas con fotos, novedad "no armable",
  ejecución con 2 fotos, cierre con encuesta de satisfacción y firma del cliente.
- Jornada: marcaciones con selfie y GPS, kilometraje, sustento por llegada tarde o extensión,
  actividades con foto.
- **Maestro de rostros** (varios empleados en el mismo celular): cada empleado registra su rostro una vez en
  Marcar jornada (con autorización de datos biométricos). Cada selfie se compara al instante, también sin señal,
  con el rostro de la persona de la sesión: si no coincide pide repetir. El servidor vuelve a comparar y señala.
- Accionista: reportes financieros, PYG interactivo y por vehículo, transporte (flota, liquidaciones,
  configuración). Solo consulta.
- **Offline-first**: todo lo que el técnico registra se guarda primero en el teléfono (IndexedDB) y una
  cola lo envía en orden; lo descargado se puede consultar sin señal.
- Centro de sincronización: estado de cada operación, reintentar, descartar, bitácora.

## Requisitos
- Node.js 20+ (probado con 22) y npm.

## Instalación y ejecución
```bash
npm install
npm run dev          # desarrollo contra QA (proxy /api → QA), abre también en escritorio
npm test             # pruebas automáticas
npm run build        # build de PRODUCCIÓN (API y Supabase de producción)
npm run build:qa     # build de QA
npm run preview      # sirve dist/ localmente
```
Para probar desde el celular en la misma red: `npm run dev` muestra una URL `http://192.168.x.x:5173`.
Ojo: cámara/GPS/Service Worker exigen **HTTPS** (o `localhost`); en LAN use un túnel HTTPS
(p. ej. `cloudflared tunnel --url http://localhost:5173`) para probar esas funciones.

### Pruebas sin tocar QA ni producción (API simulada)
```bash
npm run mock-api     # terminal 1: API simulada en http://localhost:4010
npm run dev:mock     # terminal 2: app contra la simulada (Supabase desactivado)
```
Usuarios simulados: `tecnico@demo.local`, `accionista@demo.local` y `admin@demo.local` (clave `demo123`).
Para que el mock compare rostros con el código real del backend, arrancarlo con
`MOCK_FACE_MODULE=<monorepo>/apps/api/src/modules/hr/face-identity.js`.
Los modelos de rostro (~10 MB) se copian solos a `public/models/human/` en `npm run dev`/`build` (`npm run models`).
Para simular caída del servidor:
`curl -X POST localhost:4010/__mock/mode -H "content-type: application/json" -d "{\"mode\":\"drop\"}"`
(volver con `"ok"`). `GET /__mock/log` muestra lo que recibió la API.

## Configuración (`.env.*`)
| Variable | Uso |
|---|---|
| `VITE_API_BASE_URL` | Base de la API. Por defecto `/api/v1` (mismo dominio + proxy). |
| `APEXOS_API_TARGET` | A dónde reenvía `/api` el servidor de Vite (dev/preview). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` | Proyecto Supabase del **mismo** ambiente que la API (clave publicable: pública por diseño). |
| `VITE_APEXOS_ENV` | Nombre del ambiente, se muestra en Ajustes. |
| `VITE_ALLOW_DESKTOP` | `true` solo para desarrollo: permite abrir en computador. |
| `VITE_LUNCH_SELFIE_REQUIRED` | Pedir selfie en almuerzo (compatibilidad con servidores anteriores). |

## Publicar en un dominio HTTPS
La API de producción **solo acepta CORS de los dominios en `ALLOWED_ORIGINS`** (verificado en
`apps/api/server.js` y con una petición de prueba). Hay dos caminos:

**A. Proxy inverso (recomendado, no requiere cambios en la API).** El hosting sirve la app y reenvía
`/api/*` a Railway en el mismo dominio. Plantillas listas en `deploy/`:
- Netlify: copiar `deploy/netlify.toml` a la raíz → conectar el repo → deploy.
- Vercel: copiar `deploy/vercel.json` a la raíz → importar el proyecto.
- Servidor propio: `npm run build`, subir `dist/` y usar `deploy/nginx.conf` (con Let's Encrypt).

Las plantillas apuntan a **producción**; para un sitio de QA cambie el destino de `/api` a
`https://apexos-api-qa-production.up.railway.app` y use `npm run build:qa`.

**B. Llamada directa.** Agregar el dominio (p. ej. `https://movil.empresa.com`) a `ALLOWED_ORIGINS`
en Railway y compilar con `VITE_API_BASE_URL=https://apexos-api-prod-production.up.railway.app/api/v1`.

En ambos casos: HTTPS obligatorio (cámara, GPS, Service Worker y WebCrypto lo exigen), y
`sw.js` sin caché en el CDN (incluido en las plantillas).

### Instalar en el teléfono
- **Android (Chrome):** abrir la URL → menú ⋮ → "Instalar app" / "Agregar a pantalla principal".
- **iPhone (Safari):** abrir la URL → Compartir → "Agregar a inicio". Recomendado: así Safari no
  borra los datos locales por inactividad.

## Estructura
```
src/
  app/            App, rutas, navegación inferior, protección de rutas, bloqueo de escritorio
  components/     UI reutilizable (botones, paneles, fotos, firma, banner de sincronización, reportes)
  config/         ambiente y endpoints (copiados de api_config.dart)
  core/           utilidades: JSON tolerante, ids, backoff, formatos, detección de dispositivo
  services/       cliente API (refresh único), Supabase, fotos/compresión, GPS
  storage/        Dexie (outbox, files, cache, secrets, syncLog), almacén cifrado, caché offline
  sync/           cola: requests, dao, sender, motor de sincronización, provider de React
  modules/        auth, orders, attendance, finance, transport, profile, sync
scripts/mock-api.mjs   API simulada para pruebas locales
deploy/                Netlify, Vercel, Nginx
docs/                  inventario técnico y verificación
```

## Estado
Ver [docs/VERIFICACION.md](docs/VERIFICACION.md): qué está probado, qué falta y limitaciones.
