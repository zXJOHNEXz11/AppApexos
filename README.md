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

## Publicar en Railway
El repositorio trae `Dockerfile` + `railway.json`: Railway compila la PWA y nginx la sirve, reenviando
`/api/*` a la API de APEXOS en el mismo dominio (sin CORS, sin cambios en la API). Railway pone el HTTPS.

1. Railway → *New* → *Deploy from GitHub repo* → este repositorio (rama `main`).
2. Servicio → *Variables*:

   | Variable | QA | Producción |
   |---|---|---|
   | `APEXOS_MODE` | `qa` | `production` |
   | `API_UPSTREAM` (opcional) | por defecto la de `.env.qa` | por defecto la de `.env.production` |

   `APEXOS_MODE` se usa al **compilar**: API y Supabase quedan del mismo ambiente. Un servicio por ambiente.
3. Servicio → *Settings* → *Networking* → *Generate Domain* (o un dominio propio).
4. Abrir `https://<dominio>/health` → `ok`.

**Antes de usar huella y rostro** en ese ambiente, la API debe tener desplegados los cambios de
huella/rostro (monorepo APEXOS), las migraciones `hr_face_enrollments`, `hr_shared_devices` y
`hr_webauthn_credentials`, y estas variables en el servicio de la API:
`WEBAUTHN_ORIGINS=https://<dominio>` y `WEBAUTHN_RP_IDS=<dominio>`.
Sin eso la app abre y se entra con correo y clave (órdenes, finanzas, transporte), pero **no deja
marcar jornada**: marcar exige rostro y huella registrados, y esas rutas no existen en una API sin esos cambios.

**Elegir el dominio definitivo desde el principio:** las huellas quedan atadas al dominio; si se
cambia (p. ej. de `*.up.railway.app` a `movil.empresa.com`) cada persona debe registrar su huella otra vez.

**Límite de intentos de ingreso:** con el proxy, la API ve a todos los celulares con la IP del servicio
web; su límite de `/auth/login` (10 por minuto por IP) se comparte. Si al inicio de turno entra mucha
gente a la vez, usar la llamada directa (camino B abajo): `VITE_API_BASE_URL` como variable del servicio
y el dominio de la app en `ALLOWED_ORIGINS` de la API.

Probar la imagen en el computador:
```bash
docker build -t apexos-web-movil:qa --build-arg APEXOS_MODE=qa .
docker run --rm -p 8080:8080 apexos-web-movil:qa      # http://localhost:8080
```

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
deploy/                Railway (nginx + proxy), Netlify, Vercel, Nginx
Dockerfile, railway.json   imagen para Railway
docs/                  inventario técnico y verificación
```

## Estado
Ver [docs/VERIFICACION.md](docs/VERIFICACION.md): qué está probado, qué falta y limitaciones.
