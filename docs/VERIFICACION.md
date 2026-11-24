# Verificación: qué está probado, qué falta y limitaciones

Fecha: 2026-11-21. Versión 1.0.0.

## Cómo se probó
1. **Pruebas automáticas** (`npm test`, Vitest + fake-indexeddb): **33/33 OK**.
   Motor de sincronización (orden, bloqueo por solicitud/orden, reintentos y backoff, tope de
   intentos, 401, novedad ambigua, evidencia ya capturada, archivo perdido, colas separadas, aislamiento
   por usuario, reclamo atómico, recuperación de "enviando", purga, descartar), payloads reales
   (foto, marcación web, cambio de estado con versión fresca) y reglas de visibilidad por rol y formatos.
2. **Navegador con emulación de Android (375×812, UA móvil)** contra la **API simulada local**
   (`scripts/mock-api.mjs`), que reproduce rutas y formas de respuesta de Flutter y del backend.
   No se usaron credenciales reales ni se llamó a QA/producción.
3. **Build de producción** (`vite build`): bloqueo de escritorio, Service Worker activo, 15 archivos
   precacheados, manifest.

## Funciones VERIFICADAS (en navegador contra API simulada)
| Función | Resultado |
|---|---|
| Login API, validaciones, error de credenciales, restauración de sesión con `/auth/me` | ✅ |
| Pestañas y rutas por rol (técnico vs. accionista); rutas protegidas | ✅ |
| Lista de órdenes, pestañas, búsqueda, detalle, avance, llamar / mapa | ✅ |
| **Sin conexión**: iniciar servicio + inspección con foto encolados; estado optimista; banner "pendientes" | ✅ |
| Al volver el servidor: envío en orden (inicio → foto → inspección → ejecución) con `Idempotency-Key` | ✅ |
| Ejecución (2 fotos) → `PATCH status` con **versión fresca** (`expected_version` 1 → 3) | ✅ |
| Cierre: encuesta desde API + firma PNG + `PATCH close` con `metadata.satisfaction_survey` | ✅ |
| Compresión de fotos (2400×1800 → 539 KB JPEG); selfie liviana; vista previa | ✅ |
| Jornada: secuencia, kilometraje obligatorio con placa, detección de llegada tarde, motivo + sustento + foto, selfie | ✅ |
| Payload de marcación web (`identity_photo` y `extra_evidence` al primer nivel, `source=apexos-web-movil`) | ✅ |
| Cierre de sesión con pendientes: advertencia; se borra caché y token; **la operación se conserva** | ✅ |
| Otro usuario en el mismo teléfono **no** envía operaciones ajenas; al volver el dueño, se envían | ✅ |
| Token, refresh y usuario **cifrados** en IndexedDB | ✅ |
| Reportes financieros (resumen, KPIs, balance de prueba, impuestos), PYG interactivo | ✅ |
| Torre de liquidaciones | ✅ |
| Bloqueo en escritorio (build de producción) y PWA instalable con Service Worker | ✅ |

## Implementadas pero NO verificadas en un teléfono real
- Cámara real (Chrome Android / Safari iPhone): se usa `<input capture>`; se probó inyectando imágenes.
- GPS real: en el navegador de pruebas el permiso estaba negado; se verificó que la marcación sigue y
  queda `sin_gps_permiso_negado`. Falta probar lectura fresca y "aproximada" en campo.
- Instalación en pantalla de inicio de iPhone y áreas seguras (notch) en un dispositivo físico.
- Pantallas de Flota, detalle de liquidación, configuración de transporte, PYG por vehículo,
  presupuesto PYG, plan de cuentas, asientos y cartera: compiladas y con datos simulados mínimos,
  sin revisión visual completa una por una.
- Actividades de jornada (formulario y envío): implementado y cubierto por prueba automática de cola;
  sin recorrido completo en navegador.
- Login con respaldo Supabase (usuarios creados desde la web): implementado como en Flutter, no probado
  (desactivado a propósito en el modo simulado).

## PENDIENTE antes de producción (requiere al equipo / backend)
1. **Contrato de evidencias**: igual que Flutter, se usa `POST /services/orders/:id/photos` con
   `base64_data`. El propio código Flutter advierte que no se confirmó si es el contrato vigente
   frente a `evidence-upload-authorizations`. Confirmar con backend.
2. **Canal web de marcación en el servidor desplegado**: `webIdentity` existe en el monorepo (commit
   del 14-nov-2026). Confirmar que esa versión está desplegada en QA/PROD.
3. **Selfie en almuerzo**: el backend nuevo no la exige; por compatibilidad con servidores anteriores se
   pide (`VITE_LUNCH_SELFIE_REQUIRED=true`). Poner `false` cuando se confirme el despliegue.
4. **Probar en QA con un usuario técnico real** (desde un teléfono), recorriendo el flujo completo.
5. **Dominio + proxy `/api`** (ver README) o agregar el dominio a `ALLOWED_ORIGINS` de la API.

## Limitaciones conocidas
- **Marcación web = `photo_only`**: sin huella ni firma del dispositivo. Es una decisión del backend
  para el canal web; la app nativa sigue siendo la que produce marcaciones `verified`.
- **Sin sincronización en segundo plano real**: si el técnico cierra el navegador con pendientes, se
  envían la próxima vez que abra la app (como pide el requerimiento, no se depende del fondo).
- **Almacenamiento del navegador**: Safari puede borrar datos de sitios no usados en ~7 días si la app
  no está instalada en la pantalla de inicio. Se pide almacenamiento persistente y se recomienda
  instalar la PWA. Si se borra, una foto pendiente se marca "La foto ya no está en el teléfono".
- **Detección de celular**: es una restricción de interfaz (user-agent/puntero), no de seguridad.
- **XSS**: el cifrado local protege contra copia de archivos, no contra código malicioso en la misma
  página; se mitiga con CSP estricta (ver `deploy/`) y sin scripts de terceros.
- `npm audit` reporta 2 avisos moderados en `glob`/`minimatch`, dependencias de **build**
  (workbox-build), no incluidas en la app publicada.

## Celular del camión (maestro de celulares con huella) — 2026-11-22

**Qué hace:** un administrador registra el celular del camión (placa) con una llave WebAuthn creada con la huella
del teléfono. En ese celular marcan las personas con malla de HOY en esa placa: elegir persona → selfie → huella del
celular. La marcación queda `device_verified` (celular autorizado) con la selfie como prueba de la persona.

**Verificado (navegador emulando Android + API simulada que verifica con el módulo REAL del backend
`apps/api/src/modules/hr/shared-device-identity.js`):**
| Prueba | Resultado |
|---|---|
| Registro del celular (reto HMAC, origen, dominio, bandera de huella, llave P-256) | ✅ |
| Modo camión: tripulación del día (conductor con sesión + auxiliar) | ✅ |
| El conductor con sesión marca al AUXILIAR: firma aceptada, `device_verified`, empleado 8 | ✅ |
| Marcación firmada SIN SEÑAL, encolada y aceptada al volver la conexión | ✅ |
| Kilometraje, malla, placa y selfie en el payload | ✅ |
| Pruebas backend (16) y web (39, incluye formato del mensaje y reto idénticos al servidor) | ✅ |

**Nota de prueba:** en la automatización no hay lector de huella; se usó un autenticador WebAuthn de software
(llaves P-256 reales, mismo formato del estándar). Falta probar con el lector real de un teléfono, lo que exige
publicar la app en un dominio HTTPS (WebAuthn no funciona por IP).

**Corrección incluida:** si la API responde `{ok:false, preoperational_required:true}` (conductor sin checklist
preoperacional), la cola ya no la da por enviada: queda `fallida` con el motivo.

**Pendiente para producción (equipo backend):** aplicar la migración `20261121230000_hr_shared_devices`, configurar
`WEBAUTHN_ORIGINS` y `WEBAUTHN_RP_IDS` con el dominio de la app, y desplegar. Llenar el checklist preoperacional
desde el celular no está incluido.

## Maestro de rostros (reemplaza al "modo camión" en la app) — 2026-11-22

Varios empleados marcan en el mismo celular y el lector de huella del teléfono no identifica a la persona. Cada
empleado registra su rostro en **Marcar jornada** (autorización de datos biométricos, versión y hash guardados) y
cada selfie se compara con el rostro de la persona de la sesión, en el celular (sin señal) y en el servidor.
El "modo camión" se quitó de la app; su backend (commit 62d3291b) sigue en el monorepo.

**Motor:** Human 3.3.6 (MIT). Celular: WebGL (CPU de respaldo), modelos precacheados (~10 MB). Servidor: wasm, sin
binarios nativos. Misma fórmula de similitud (coseno) en ambos lados; umbral 0,55.

| Prueba | Resultado |
|---|---|
| Spike en Node: misma persona 0,83 / persona distinta 0,35 (coseno) | ✅ |
| Registro: autorización obligatoria, una sola cara, 409 si ya existe, solo admin restablece | ✅ (pruebas) |
| Navegador: registrar rostro → marcar con la cara de OTRA persona → "no coincide", no marca | ✅ |
| Navegador: misma persona con otra luz/compresión → marca; celular y servidor = 0,84 coincide | ✅ |
| Servidor: si no coincide, la marcación se registra igual pero SEÑALADA (`face_match`) | ✅ (pruebas) |
| Monitor: página Rostros registrados y nota "ROSTRO NO COINCIDE" en Reportes | ✅ (pruebas de fuente, tsc) |

**Pendiente:** probar con la cámara real del celular; **calibrar el umbral** con selfies reales del personal; el
antispoof/liveness queda **informativo** (en fotos reales dio 0,49–0,67, no sirve aún para bloquear); revisión jurídica
del texto de autorización; en QA/PROD: migración `20261122060000_hr_face_enrollments` y despliegue.
