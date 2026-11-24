# Inventario técnico de la app Flutter (Fase 1)

Fuente: `Downloads/apexos-movil-proyecto.zip` → `apexos_movil/` (Flutter, Dart ^3.12), analizado en
una **copia de solo lectura**. No se modificó el ZIP ni ningún archivo original. También se leyó (solo
lectura) el backend del monorepo `OneDrive/Documents/APEXOS/APEXOS/apps/api` para verificar CORS y
el contrato de marcación web.

## Arquitectura original
| Capa | Flutter | Equivalente web |
|---|---|---|
| Estado | `provider` (Auth, Orders, Outbox) | React Context + TanStack Query |
| HTTP | `http`, `ApiClient` singleton con refresh único ante 401 | `services/apiClient.ts` (misma lógica) |
| Sesión | `flutter_secure_storage` (Keystore) | IndexedDB cifrado con AES-GCM no extraíble (`storage/secureStore.ts`) |
| Cola offline | SQLite (`sqflite`), tabla `outbox` | IndexedDB (Dexie), tabla `outbox` |
| Fondo | `workmanager` cada 15 min | No existe en web: se sincroniza al abrir, al volver la red, al volver a primer plano, cada 30 s y manual |
| Cámara | `image_picker`, `camera` (selfie) | `<input type=file capture>` (cámara nativa) |
| Compresión | `flutter_image_compress` | Canvas (mismos topes) |
| GPS | `geolocator` | `navigator.geolocation` |
| Firma cliente | `signature` | Canvas con eventos de puntero |
| Huella | `local_auth` + llave EC en Keystore (DeviceKeyChannel.kt) | **No disponible**: canal web del backend (ver abajo) |

## Ambientes (de `api_config.dart` / `supabase_config.dart`)
- API PROD `https://apexos-api-prod-production.up.railway.app/api/v1` + Supabase PROD.
- API QA `https://apexos-api-qa-production.up.railway.app/api/v1` + Supabase QA.
- Login: primero `POST /auth/login`; si responde 401/404, respaldo con Supabase Auth (`grant_type=password`) y luego `GET /auth/me`.

## Pantallas y funcionalidades encontradas
| Módulo | Pantallas Flutter | Endpoints |
|---|---|---|
| Autenticación | splash, login | `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`, Supabase `/auth/v1/token` |
| Inicio / navegación | home, shell (pestañas por rol) | — |
| Órdenes de servicio | my_services, order_detail | `GET /services/orders?limit=200`, `GET /services/orders/:id`, `PATCH …/start` |
| Inspección | inspection | `POST …/photos` (tipo `pieza`), `PATCH …/inspection`, `PATCH …/execution`, `POST …/incidents` |
| Ejecución | execution | `POST …/photos` (`producto_abierto`, `producto_cerrado`), `PATCH …/items/:id/status` |
| Cierre | closure (encuesta + firma) | `GET /services/satisfaction-questions`, `POST …/photos` (`firma_cliente`), `PATCH …/close` |
| Jornada / asistencia | attendance, selfie_camera | `/hr/self/attendance?flat=1`, `/hr/self/routes`, `/hr/self/work-session`, `/hr/self/activity-types`, `POST /hr/self/time-punches`, `POST /hr/self/work-activities`, `/hr/self/biometric-enrollment` |
| Reportes financieros (accionista) | finance_reports, pyg_interactive | `/accounting/reports/*`, `/accounting/periods`, `/accounting/accounts`, `/accounting/documents`, `/accounting/ledger/:code`, `/transport-pyg/*` |
| Transporte y flota (accionista) | transport_home, fleet, settlement_tower (+detalle), transport_config | `/transport/vehicles/metrics/dashboard`, `/transport/settlement-*`, `/transport-pyg/config` |
| Perfil / configuración | profile, personal, user_settings | (solo lectura del usuario) |
| Notificaciones | notifications | **Sin API**: muestra el estado de la cola |
| Sincronización | outbox_banner + worker | (cola local) |

## Reglas de negocio relevantes (conservadas)
- Visibilidad por rol: `canSeeServices`, `canSeeFinance`, `canSeeTransport`, `canMarkAttendance` (idénticas a `user.dart`).
- Flujo de orden: Inicio → Inspección → Ejecución → Cierre; "Continuar" lleva a ejecución si la solicitud está en `ejecucion`, si no a inspección.
- Toda pieza con novedad exige foto de soporte. Ejecución exige 2 fotos. Cierre exige todas las preguntas activas (1–5) y firma.
- Cola FIFO por orden (o por tipo si no hay orden); una operación fallida detiene las siguientes de su solicitud/orden.
- Backoff 5 s, 15 s, 45 s, 2 min, 5 min, 15 min, 30 min; tras 8 fallos queda `fallida`.
- `POST /incidents` no es idempotente en la API: un error ambiguo se deja `fallida` (no se reintenta solo).
- `SERVICE_EVIDENCE_ALREADY_CAPTURED` se da por enviada.
- Cambio de estado de solicitud: se relee la orden y se manda la versión fresca (`expected_version`).
- Marcaciones: orden entrada → almuerzo → retorno; salida tras entrada; kilometraje si hay placa (`^\d+(\.\d)?$`); sustento (motivo + texto + foto) fuera de tolerancia; fotos como data URL.
- Evidencias ≤ 2 MB (JPEG 0.85→0.40); selfie ≤ 300 KB.

## Incompatibilidades documentadas y alternativa aplicada
| Función Flutter | Por qué no aplica en web | Alternativa |
|---|---|---|
| Huella + llave EC del Keystore para firmar marcaciones (`metadata.source = apexos-movil`) | El navegador no puede exigir huella para firmar un mensaje arbitrario, ni acceder al Keystore/ANDROID_ID | El backend YA tiene un canal web (`webIdentity` en `hr/mobile-identity.js`): selfie en `identity_photo` al primer nivel, sin firma; la marcación queda `photo_only` (el supervisor ve la cara; no es prueba criptográfica). Mismo contrato que usa la web de APEXOS. |
| Registro biométrico (`/hr/self/biometric-enrollment`) | Depende de lo anterior | No se usa en web. |
| WorkManager (drenar la cola con la app cerrada) | Los navegadores móviles suspenden pestañas | Sincronización al abrir, al volver la red, al volver a primer plano, cada 30 s con la app abierta, y botón manual. |
| Cámara frontal en vista propia (`camera`) | Funciona con getUserMedia, pero falla en PWAs de iOS en algunas versiones | `<input capture="user">` abre la cámara frontal nativa. |
