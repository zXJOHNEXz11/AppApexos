#!/usr/bin/env node
/**
 * API SIMULADA de APEXOS, solo para pruebas locales (NO es la API real).
 *
 * Reproduce las rutas y formas de respuesta que usa la app Flutter
 * (`lib/config/api_config.dart`, modelos) y el contrato web del backend
 * (`webIdentity`), para probar el flujo completo sin tocar QA ni producción
 * y sin usar credenciales reales.
 *
 *   node scripts/mock-api.mjs            (puerto 4010)
 *   APEXOS_API_TARGET=http://localhost:4010 npm run dev
 *
 * Usuarios de prueba (solo existen aquí):
 *   tecnico@demo.local / demo123     → técnico (servicios + jornada)
 *   accionista@demo.local / demo123  → accionista (reportes + transporte)
 *
 * Control de fallas para pruebas:
 *   POST /__mock/mode {"mode":"ok"|"500"|"drop"}   (drop = corta la conexión)
 *   GET  /__mock/log                                  (lo recibido por la API)
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Verificacion REAL de las firmas del celular del camion: si MOCK_VERIFY_MODULE apunta a
// apps/api/src/modules/hr/shared-device-identity.js del monorepo, se usa ese mismo codigo.
const require = createRequire(import.meta.url);
let sharedIdentity = null;
if (process.env.MOCK_VERIFY_MODULE) {
  sharedIdentity = require(process.env.MOCK_VERIFY_MODULE);
  console.log('Firmas del camion verificadas con:', process.env.MOCK_VERIFY_MODULE);
}
const MOCK_SECRET = 'mock-secret';

// Maestro de rostros: si MOCK_FACE_MODULE apunta a apps/api/src/modules/hr/face-identity.js
// del monorepo, la comparación usa ese mismo código (Human wasm en Node).
let faceIdentity = null;
let faceConsent = null;
if (process.env.MOCK_FACE_MODULE) {
  faceIdentity = require(process.env.MOCK_FACE_MODULE);
  faceConsent = require(process.env.MOCK_FACE_MODULE.replace(/face-identity\.js$/, 'face-consent.js'));
  console.log('Rostros comparados con:', process.env.MOCK_FACE_MODULE);
}
const faceEnrollments = new Map(); // user_id -> { embedding, enrolled_at, photo }

// Huella propia: personal-webauthn.js y shared-device-identity.js del mismo directorio.
let personalWebauthn = null;
let sharedIdentityForChallenge = null;
if (process.env.MOCK_FACE_MODULE) {
  personalWebauthn = require(process.env.MOCK_FACE_MODULE.replace(/face-identity\.js$/, 'personal-webauthn.js'));
  sharedIdentityForChallenge = require(process.env.MOCK_FACE_MODULE.replace(/face-identity\.js$/, 'shared-device-identity.js'));
  console.log('Huellas verificadas con personal-webauthn.js real');
}
const webauthnCreds = new Map(); // user_id -> [credenciales]
const webauthnCfg = (req) => {
  const origin = req.headers.origin || '';
  let host = 'localhost';
  try { host = new URL(origin).hostname; } catch { /* sin origen */ }
  return { allowedOrigins: (process.env.WEBAUTHN_ORIGINS || origin).split(',').filter(Boolean), allowedRpIds: (process.env.WEBAUTHN_RP_IDS || host).split(',') };
};
const dataUrlBytes = (v) => Buffer.from(String(v || '').replace(/^data:[^,]*,/, ''), 'base64');
const sharedDevices = [];
const crewPunches = [];

const PORT = Number(process.env.MOCK_PORT || 4010);
let mode = 'ok';
const received = [];
const seenKeys = new Map(); // idempotencia simulada

const USERS = {
  'tecnico@demo.local': {
    user: { id: 7, name: 'Técnico Demo', email: 'tecnico@demo.local', role: { name: 'Tecnico' }, role_permissions: [{ module: 'services', action: 'read' }, { module: 'hr', action: 'read' }], role_metadata: {}, tenant_id: 'demo' },
    tenant: { id: 'demo', name: 'Empresa Demo', active_modules: ['m-26', 'm-17'] },
  },
  'accionista@demo.local': {
    user: { id: 9, name: 'Accionista Demo', email: 'accionista@demo.local', role: { name: 'Accionista' }, role_permissions: ['accounting:read', 'transport:read'], role_metadata: {}, tenant_id: 'demo' },
    tenant: { id: 'demo', name: 'Empresa Demo', active_modules: ['m-07', 'm-14'] },
  },
};
USERS['admin@demo.local'] = {
  user: { id: 5, name: 'Admin Demo', email: 'admin@demo.local', role: { name: 'Administrador' }, role_permissions: ['hr:write', 'hr:read', 'time_tracking:write'], role_metadata: {}, tenant_id: 'demo' },
  tenant: { id: 'demo', name: 'Empresa Demo', active_modules: ['m-26', 'm-17'] },
};
const tokens = new Map();

const today = new Date();
const iso = (d) => d.toISOString();
const parts = [
  { id: 101, reference_id: 1, name: 'Puerta izquierda', quantity: 1, unit: 'und', display_order: 1 },
  { id: 102, reference_id: 1, name: 'Herraje central', quantity: 4, unit: 'und', display_order: 2 },
];
const orders = [
  {
    id: 501, number: 'OS-000501', status: 'pendiente', service_type: 'montaje', customer_name: 'Laura Gómez', customer_address: 'Cra 15 # 93-60, Bogotá',
    customer_phone: '3001234567', invoice_number: 'FV-2231', scheduled_date: iso(today), notes: 'Llamar 30 min antes.',
    items: [{ id: 9001, reference_id: 1, reference: { code: '050322', name: 'Mueble marshala', parts }, service_type: 'montaje', quantity: 1, status: 'pendiente', version: 1 }],
    incidents: [], photos: [],
  },
  {
    id: 502, number: 'OS-000502', status: 'agendado', service_type: 'montaje', customer_name: 'Carlos Ruiz', customer_address: 'Calle 80 # 11-42, Bogotá',
    scheduled_date: iso(new Date(today.getTime() + 86400000)),
    items: [{ id: 9002, reference_id: 2, reference: { code: '070101', name: 'Closet nogal', parts: [] }, service_type: 'montaje', quantity: 1, status: 'pendiente', version: 1 }],
    incidents: [], photos: [],
  },
];

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });

function auth(req) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  return tokens.get(t) || null;
}

const order = (id) => orders.find((o) => o.id === id);
const shrink = (b) => JSON.parse(JSON.stringify(b, (k, v) => (typeof v === 'string' && v.startsWith('data:') ? `${v.slice(0, 30)}…(${v.length} chars)` : v)));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const body = req.method === 'GET' ? {} : await readBody(req);

  if (path === '/__mock/mode') { mode = body.mode || 'ok'; return send(res, 200, { mode }); }
  if (path === '/__mock/log') return send(res, 200, received);
  if (mode === 'drop') { req.socket.destroy(); return; }
  if (mode === '500') return send(res, 503, { message: 'Servicio no disponible (simulado)' });

  if (req.method !== 'GET') received.push({ at: new Date().toISOString(), method: req.method, path, idem: req.headers['idempotency-key'] || null, body: shrink(body) });

  // ---- Auth
  if (path === '/auth/login' && req.method === 'POST') {
    const u = USERS[String(body.email || '').toLowerCase()];
    if (!u || body.password !== 'demo123') return send(res, 401, { message: 'Credenciales inválidas' });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    tokens.set(token, u);
    return send(res, 200, { token, refresh: `ref-${token}`, ...u });
  }
  if (path === '/auth/refresh') {
    const old = String(body.refresh || '').replace(/^ref-/, '');
    const u = tokens.get(old);
    if (!u) return send(res, 401, { message: 'Refresh inválido' });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    tokens.set(token, u);
    return send(res, 200, { token, refresh: `ref-${token}` });
  }
  // Ingreso con huella: personal-webauthn.js REAL (reto de un solo uso + firma).
  if (path === '/auth/webauthn/challenge' && req.method === 'POST') {
    if (!personalWebauthn) return send(res, 503, { message: 'Ingreso con huella no configurado', code: 'WEBAUTHN_NO_CONFIGURADO' });
    try {
      return send(res, 200, personalWebauthn.issueLoginChallenge({ tenantId: body.tenant_id, userId: body.user_id, secret: MOCK_SECRET }));
    } catch (e) {
      return send(res, e.statusCode || 400, { message: e.message, code: e.code });
    }
  }
  if (path === '/auth/webauthn/login' && req.method === 'POST') {
    if (!personalWebauthn) return send(res, 503, { message: 'Ingreso con huella no configurado', code: 'WEBAUTHN_NO_CONFIGURADO' });
    try {
      const { tenantId, userId } = personalWebauthn.consumeLoginChallenge(body.challenge, { secret: MOCK_SECRET });
      const cred = tenantId === 'demo' ? (webauthnCreds.get(userId) || []).find((c) => c.active && c.credential_id === body.credential_id) : null;
      const r = personalWebauthn.verifyLoginAssertion({ credential: cred, userId, input: body, ...webauthnCfg(req) });
      cred.sign_count = r.sign_count;
      const entry = Object.values(USERS).find((x) => x.user.id === userId);
      if (!entry) return send(res, 401, { message: 'No fue posible entrar con tu huella. Entra con tu correo y clave.', code: 'HUELLA_USUARIO_NO_DISPONIBLE' });
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      tokens.set(token, entry);
      received[received.length - 1].ingreso_huella = { status: 'ok', user_id: userId };
      return send(res, 200, { token, refresh: `ref-${token}`, ...entry });
    } catch (e) {
      received[received.length - 1].ingreso_huella = { status: 'rechazado', code: e.code };
      return send(res, e.statusCode || 400, { message: e.message, code: e.code });
    }
  }

  const u = auth(req);
  if (!u) return send(res, 401, { message: 'Sesión expirada' });
  if (path === '/auth/me') return send(res, 200, u);
  if (path === '/auth/logout') return send(res, 200, { ok: true });

  // ---- Servicios
  if (path === '/services/orders' && req.method === 'GET') {
    const active = orders.filter((o) => !['cerrada', 'no_ejecutada', 'cancelada'].includes(o.status));
    return send(res, 200, { data: active, kpis: { total: active.length } });
  }
  if (path === '/services/satisfaction-questions') {
    return send(res, 200, { data: [
      { id: 'service_quality', label: '¿Cómo califica la calidad del servicio?', active: true },
      { id: 'technician_attention', label: '¿Cómo fue la atención del técnico?', active: true },
      { id: 'final_result', label: '¿Quedó satisfecho con el resultado final?', active: true },
    ] });
  }
  let m = path.match(/^\/services\/orders\/(\d+)(?:\/(.*))?$/);
  if (m) {
    const o = order(Number(m[1]));
    if (!o) return send(res, 404, { message: 'No encontrado' });
    const sub = m[2] || '';
    if (!sub && req.method === 'GET') return send(res, 200, { data: o });
    if (sub === 'start') { o.status = 'en_curso'; o.started_at = new Date().toISOString(); return send(res, 200, { data: o }); }
    if (sub === 'inspection') {
      const it = o.items.find((i) => i.id === body.item_id);
      if (!it || !Array.isArray(body.items) || body.items.some((p) => !p.part_id || !p.name)) return send(res, 422, { message: 'Inspección inválida' });
      it.status = body.decision === 'no_armable' ? 'bloqueada' : 'inspeccion'; it.version++;
      o.status = 'inspeccion';
      return send(res, 200, { data: o });
    }
    if (sub === 'execution') { const it = o.items.find((i) => i.id === body.item_id); it.status = 'ejecucion'; it.version++; o.status = 'ejecucion'; return send(res, 200, { data: o }); }
    if (sub === 'photos') {
      const key = body.metadata?.client_upload_id;
      if (!String(body.base64_data || '').startsWith('data:image/')) return send(res, 422, { message: 'base64_data debe ser data URL' });
      if (seenKeys.has(key)) return send(res, 200, seenKeys.get(key));
      const dup = o.photos.find((p) => p.type === body.type && p.item_id === body.item_id && body.type !== 'pieza');
      if (dup) return send(res, 409, { message: 'Ya existe esa evidencia', code: 'SERVICE_EVIDENCE_ALREADY_CAPTURED' });
      const photo = { id: o.photos.length + 1, type: body.type, item_id: body.item_id };
      o.photos.push(photo);
      seenKeys.set(key, { data: photo });
      return send(res, 201, { data: photo });
    }
    if (sub === 'incidents') { o.incidents.push({ id: o.incidents.length + 1, ...body }); return send(res, 201, { data: o }); }
    if (sub === 'close') {
      const answers = body.metadata?.satisfaction_survey?.answers || [];
      if (answers.length < 3) return send(res, 422, { message: 'Falta la encuesta de satisfacción' });
      o.status = 'cerrada'; o.closed_at = new Date().toISOString();
      return send(res, 200, { data: o });
    }
    const st = sub.match(/^items\/(\d+)\/status$/);
    if (st) {
      const it = o.items.find((i) => i.id === Number(st[1]));
      if (it.version !== body.expected_version) return send(res, 409, { message: 'La solicitud cambió de estado' });
      it.status = body.status; it.version++;
      return send(res, 200, { data: o });
    }
  }

  // ---- Maestro de celulares compartidos (camion)
  if (path.startsWith('/hr/shared-devices')) {
    const origins = (process.env.WEBAUTHN_ORIGINS || req.headers.origin || '').split(',').map((x) => x.trim()).filter(Boolean);
    // Sin WEBAUTHN_RP_IDS se usa el dominio del origen de la peticion (util con un tunel
    // HTTPS temporal, cuyo dominio cambia en cada arranque). Solo para pruebas locales.
    const originHost = (() => { try { return new URL(req.headers.origin || '').hostname; } catch { return 'localhost'; } })();
    const cfg = { allowedOrigins: origins, allowedRpIds: (process.env.WEBAUTHN_RP_IDS || originHost).split(',') };
    const isAdmin = /admin/i.test(u.user.role?.name || '');
    try {
      if (path === '/hr/shared-devices/registration-challenge' && req.method === 'POST') {
        if (!isAdmin) return send(res, 403, { message: 'Solo un administrador puede registrar celulares.', code: 'CELULAR_ADMIN_REQUERIDO' });
        return send(res, 200, sharedIdentity ? sharedIdentity.issueRegistrationChallenge({ tenantId: 'demo', userId: u.user.id, secret: MOCK_SECRET }) : { challenge: Buffer.from('mock').toString('base64url') });
      }
      if (path === '/hr/shared-devices' && req.method === 'POST') {
        if (!isAdmin) return send(res, 403, { message: 'Solo un administrador puede registrar celulares.', code: 'CELULAR_ADMIN_REQUERIDO' });
        const record = sharedIdentity
          ? sharedIdentity.verifyRegistration({ input: body, tenantId: 'demo', user: u.user, secret: MOCK_SECRET, ...cfg })
          : { ...body, vehicle_plate: String(body.vehicle_plate).toUpperCase() };
        const device = { id: sharedDevices.length + 1, ...record, active: true, sign_count: record.sign_count || 0, enrolled_by: u.user.id, enrolled_at: new Date().toISOString() };
        sharedDevices.push(device);
        const { public_key: _k, ...pub } = device;
        return send(res, 201, pub);
      }
      if (path === '/hr/shared-devices' && req.method === 'GET') return send(res, 200, sharedDevices.map(({ public_key: _k, ...d }) => d));
      const m2 = path.match(/^\/hr\/shared-devices\/([^/]+)\/(crew|punches|revoke)$/);
      if (m2) {
        const [, key, action] = m2;
        if (action === 'revoke') { const d = sharedDevices.find((x) => String(x.id) === key); if (d) d.active = false; return send(res, 200, d); }
        const device = sharedDevices.find((x) => x.device_id === key && x.active);
        if (!device) return send(res, 403, { message: 'Este celular no esta registrado o fue revocado.', code: 'CELULAR_NO_REGISTRADO' });
        const crew = [
          { employee_id: 7, name: 'Técnico Demo', user_name: 'Técnico Demo' },
          { employee_id: 8, name: 'Auxiliar Demo', user_name: 'Auxiliar Demo' },
        ];
        const route = { id: 44, start_time: '07:00', end_time: '17:00', tolerance_minutes: 15, vehicle_plate: device.vehicle_plate };
        if (action === 'crew') {
          return send(res, 200, { device, crew: crew.map((c) => ({ ...c, is_current_user: c.employee_id === u.user.id, route, punches: crewPunches.filter((p) => p.employee_id === c.employee_id).map((p) => ({ type: p.type, time: p.time, punched_at: p.punched_at })) })) });
        }
        if (!crew.some((c) => c.employee_id === Number(body.employee_id))) return send(res, 403, { message: 'La persona no tiene malla hoy en este vehiculo.', code: 'EMPLEADO_FUERA_DE_TRIPULACION' });
        const replay = crewPunches.find((p) => p.idempotency_key === body.idempotency_key);
        if (replay) return send(res, 200, { ok: true, replayed: true });
        const verification = sharedIdentity
          ? sharedIdentity.verifyCrewAssertion({ device, employeeId: Number(body.employee_id), input: body, ...cfg })
          : { sign_count: 0, metadata: { identity_verification: { status: 'sin_verificar_mock' } } };
        device.sign_count = verification.sign_count;
        const punch = { employee_id: Number(body.employee_id), type: body.type, punched_at: body.punched_at, time: new Date(body.punched_at).toTimeString().slice(0, 5), idempotency_key: body.idempotency_key, verification: verification.metadata.identity_verification };
        crewPunches.push(punch);
        received[received.length - 1].verification = punch.verification;
        return send(res, 201, { ok: true, punch });
      }
    } catch (e) {
      return send(res, e.statusCode || 500, { message: e.message, code: e.code });
    }
  }

  // ---- Huella propia (WebAuthn)
  if (path === '/hr/self/webauthn' && req.method === 'GET') {
    return send(res, 200, { enrolled: (webauthnCreds.get(u.user.id) || []).length > 0, credentials: (webauthnCreds.get(u.user.id) || []).map((c) => ({ credential_id: c.credential_id, rp_id: c.rp_id, enrolled_at: c.enrolled_at })) });
  }
  if (path === '/hr/self/webauthn/registration-challenge' && req.method === 'POST') {
    if (!sharedIdentityForChallenge) return send(res, 503, { message: 'Arranca el mock con MOCK_FACE_MODULE.' });
    return send(res, 200, sharedIdentityForChallenge.issueRegistrationChallenge({ tenantId: 'demo', userId: u.user.id, secret: MOCK_SECRET }));
  }
  if (path === '/hr/self/webauthn' && req.method === 'POST') {
    try {
      const rec = personalWebauthn.verifyPersonalRegistration({ input: body, tenantId: 'demo', user: u.user, secret: MOCK_SECRET, ...webauthnCfg(req) });
      const list = webauthnCreds.get(u.user.id) || [];
      list.push({ ...rec, user_id: u.user.id, active: true, enrolled_at: new Date().toISOString() });
      webauthnCreds.set(u.user.id, list);
      received[received.length - 1].huella = { registro: 'ok', rp_id: rec.rp_id };
      return send(res, 201, { enrolled: true, credential_id: rec.credential_id, rp_id: rec.rp_id });
    } catch (e) {
      return send(res, e.statusCode || 400, { message: e.message, code: e.code });
    }
  }

  // ---- Maestro de rostros
  if (path === '/hr/self/face-enrollment') {
    if (req.method === 'GET') {
      const e = faceEnrollments.get(u.user.id);
      return send(res, 200, {
        enrolled: Boolean(e), enrolled_at: e?.enrolled_at || null, embedding: e?.embedding || null,
        match_threshold: faceIdentity ? faceIdentity.faceConfig().matchThreshold : 0.55,
        consent: { version: faceConsent?.FACE_CONSENT_VERSION || 'mock-v1', text: faceConsent?.FACE_CONSENT_TEXT || 'Texto de autorizacion de prueba.' },
      });
    }
    if (req.method === 'POST') {
      if (body.consent_accepted !== true || body.consent_version !== (faceConsent?.FACE_CONSENT_VERSION || 'mock-v1')) return send(res, 400, { message: 'Debes aceptar la autorizacion de datos biometricos vigente.', code: 'CONSENTIMIENTO_REQUERIDO' });
      if (faceEnrollments.has(u.user.id)) return send(res, 409, { message: 'Ya tienes un rostro registrado.', code: 'ROSTRO_YA_REGISTRADO' });
      if (!faceIdentity) return send(res, 503, { message: 'Arranca el mock con MOCK_FACE_MODULE para registrar rostros.' });
      const analysis = await faceIdentity.enrollmentFromImage(dataUrlBytes(body.photo?.base64));
      if (!analysis.ok) return send(res, 422, { message: analysis.message, code: analysis.code });
      const e = { embedding: analysis.embedding, enrolled_at: new Date().toISOString() };
      faceEnrollments.set(u.user.id, e);
      received[received.length - 1].face = { registro: 'ok', antispoof: analysis.antispoof, liveness: analysis.liveness, client_check: body.client_check || null };
      return send(res, 201, { enrolled: true, enrolled_at: e.enrolled_at, embedding: e.embedding, match_threshold: faceIdentity.faceConfig().matchThreshold });
    }
  }

  // ---- Jornada (contrato web: selfie en identity_photo al primer nivel)
  if (path === '/hr/self/attendance') {
    const punches = received.filter((r) => r.path === '/hr/self/time-punches' && r.ok).map((r) => ({ tipo: r.body.type, hora: new Date(r.body.punched_at).toTimeString().slice(0, 5), fecha: r.body.punched_at.slice(0, 10) }));
    return send(res, 200, punches);
  }
  if (path === '/hr/self/routes') return send(res, 200, [{ id: 33, date: iso(today).slice(0, 10), start_time: '07:00', end_time: '17:00', vehicle_plate: 'XYZ987', tolerance_minutes: 15 }]);
  if (path === '/hr/self/work-session') return send(res, 200, { active: false, activities: [], alerts: [] });
  if (path === '/hr/self/activity-types') return send(res, 200, [{ id: 1, code: 'entrega', name: 'Entrega a cliente' }, { id: 2, code: 'cargue', name: 'Cargue en bodega' }]);
  if (path === '/hr/self/time-punches' && req.method === 'POST') {
    const last = received[received.length - 1];
    if (seenKeys.has(body.idempotency_key)) return send(res, 200, seenKeys.get(body.idempotency_key));
    if (body.metadata?.source === 'apexos-movil') return send(res, 403, { message: 'Requiere firma del dispositivo', code: 'BIOMETRIA_NO_REGISTRADA' });
    if (['entrada', 'salida'].includes(body.type) && !body.identity_photo?.base64) return send(res, 400, { message: 'Toma la selfie de validacion para registrar esta marcacion.', code: 'SELFIE_REQUERIDA' });
    if (personalWebauthn) {
      const creds = webauthnCreds.get(u.user.id) || [];
      if (body.metadata?.webauthn) {
        try {
          const photoSha = body.identity_photo?.base64 ? require('node:crypto').createHash('sha256').update(dataUrlBytes(body.identity_photo.base64)).digest('hex') : undefined;
          const cred = creds.find((c) => c.credential_id === body.metadata.webauthn.credential_id);
          const r = personalWebauthn.verifyPersonalAssertion({ credential: cred, user: u.user, input: body, photoSha256: photoSha, ...webauthnCfg(req) });
          if (cred) cred.sign_count = r.sign_count;
          received[received.length - 1].huella = r.fingerprint;
        } catch (e) {
          received[received.length - 1].huella = { status: 'RECHAZADA', code: e.code };
          return send(res, e.statusCode || 403, { message: e.message, code: e.code });
        }
      } else {
        received[received.length - 1].huella = { status: creds.length ? 'no_presentada' : 'sin_registro' };
      }
    }
    last.ok = true;
    const enrolledFace = faceEnrollments.get(u.user.id);
    if (enrolledFace && faceIdentity && body.identity_photo?.base64) {
      last.face_match = await faceIdentity.evaluateSelfie({ enrolledEmbedding: enrolledFace.embedding, selfieBuffer: dataUrlBytes(body.identity_photo.base64) });
      last.face_check_celular = body.metadata?.face_check || null;
    }
    const r = { data: { id: received.length, type: body.type, identity_verification: { status: body.identity_photo ? 'photo_only' : 'not_verified', channel: 'web' } } };
    seenKeys.set(body.idempotency_key, r);
    return send(res, 201, r);
  }
  if (path === '/hr/self/work-activities' && req.method === 'POST') {
    if (!body.activity_type_id || !body.photo?.base64) return send(res, 422, { message: 'Falta tipo o foto' });
    return send(res, 201, { data: { id: received.length } });
  }

  // ---- Finanzas / transporte (datos mínimos de ejemplo)
  if (path === '/accounting/reports/balance-sheet') return send(res, 200, { assets: { total: 152000000 }, liabilities: { total: 61000000 }, equity: { total: 91000000 }, balanced: true });
  if (path === '/accounting/reports/income-statement') return send(res, 200, { income: { total: 48000000 }, operating_profit: 12500000 });
  if (path === '/accounting/reports/trial-balance') return send(res, 200, { rows: [{ code: '1105', name: 'Caja', debit: 5000000, credit: 1200000 }, { code: '1305', name: 'Clientes', debit: 22000000, credit: 9000000 }], totals: { debit: 27000000, credit: 10200000, balance: 16800000 }, balanced: true });
  if (path === '/accounting/reports/taxes') return send(res, 200, { taxes: [{ code: '2408', name: 'IVA por pagar', debit: 0, credit: 3100000 }], totals: { debit: 0, credit: 3100000, payable: 3100000 } });
  if (path === '/accounting/reports/receivables' || path === '/accounting/reports/payables') return send(res, 200, { total: 13000000, buckets: { current: 8000000, d30: 2000000, d60: 1500000, d90: 500000, over90: 1000000 }, documents: [{ number: 'FV-1001', party: { name: 'Cliente Uno SAS' }, balance: 8000000, days_overdue: 0, due_date: '2026-12-01T00:00:00.000Z' }, { number: 'FV-0950', party: { name: 'Cliente Dos' }, balance: 1000000, days_overdue: 120, due_date: '2026-07-01T00:00:00.000Z' }] });
  if (path.startsWith('/accounting/ledger/')) return send(res, 200, { account: { code: '1305', name: 'Clientes' }, totals: { debit: 22000000, credit: 9000000, balance: 13000000 }, entries: [{ date: '2026-11-03T00:00:00.000Z', description: 'Factura FV-1001', debit: 8000000, credit: 0 }] });
  if (path === '/accounting/periods') return send(res, 200, {});
  if (path === '/accounting/accounts') return send(res, 200, [{ code: '11', name: 'Disponible', type: 'asset' }, { code: '1105', name: 'Caja', type: 'asset' }, { code: '1305', name: 'Clientes', type: 'asset' }]);
  if (path === '/accounting/documents') return send(res, 200, { documents: [{ full_number: 'CC-0001', posting_date: '2026-11-03T00:00:00.000Z', header_text: 'Causación factura', total_debit: 8000000, total_credit: 8000000 }] });
  if (path === '/accounting/reports/pyg-interactive') return send(res, 200, { period: url.searchParams.get('period'), mode: url.searchParams.get('mode'), sections: [{ key: 'ingresos4', actual: 48000000, prior: 40000000, variation_pct: 20 }, { key: 'gastos5', actual: -35500000, prior: -30000000, variation_pct: 18.3 }], net: { key: '', actual: 12500000, prior: 10000000, variation_pct: 25 }, nodes: [{ key: 'n4', code: '4', name: 'Ingresos', level: 0, actual: 48000000, prior: 40000000, difference: 8000000, has_movement: true, children: [{ key: 'n41', code: '41', name: 'Operacionales', level: 1, actual: 48000000, prior: 40000000, difference: 8000000, has_movement: true, children: [] }] }], organization: { branches: [{ code: 'BOG', name: 'Bogotá' }], cost_centers: [{ code: 'CC1', name: 'Operación', branch_code: 'BOG' }] }, warnings: [], range: { start: '2026-11-01', end: '2026-11-30' }, prior_range: { start: '2025-11-01', end: '2025-11-30' }, linkage: { ledger_entries: 10, linked: 9, orphan: 1, ambiguous: 0 } });
  if (path === '/accounting/reports/pyg-interactive/budgets') return send(res, 200, { period: url.searchParams.get('period'), rows: [] });
  if (path === '/transport-pyg/report') return send(res, 200, { tax_percent: 1.2, vehicles: [], corporate: { plate: 'FLOTA', income_actual: 0, rows: [] }, data_status: { vehicle_count: 0 } });
  if (path === '/transport-pyg/config') return send(res, 200, { tax_percent: 1.2 });
  if (path === '/transport-pyg/mapping') return send(res, 200, { rows: [] });
  if (path === '/transport/vehicles/metrics/dashboard') return send(res, 200, { total: 2, active: 1, blocked: 1, pending_validation: 0, expiring: 1, average_score: 82, vehicles: [{ plate: 'XYZ987', base_site: 'Bogotá', master_status: 'apto_documentalmente', soat_days_remaining: 120, technical_review_days_remaining: 40 }, { plate: 'ABC123', master_status: 'bloqueado_documental', soat_days_remaining: -3 }] });
  if (path === '/transport/settlement-control-tower') return send(res, 200, { packages: [{ id: 1, code: 'LIQ-001', carrier_name: 'Transportes Andinos', status: 'aprobada', approved_total: 4200000, period: { code: '2026-11' } }] });
  if (path === '/transport/settlement-periods') return send(res, 200, [{ id: 1, code: '2026-11', name: 'Noviembre 2026' }]);
  if (path === '/transport/settlement-types') return send(res, 200, [{ code: 'FLETE', name: 'Flete urbano', active: true }]);
  if (path.startsWith('/transport/settlement-packages/')) return send(res, 200, { id: 1, code: 'LIQ-001', carrier_name: 'Transportes Andinos', status: 'aprobada', approved_total: 4200000, items: [{ guide_reference: 'G-77', vehicle_plate: 'XYZ987', origin_name: 'Bogotá', destination_name: 'Chía', approved_amount: 4200000 }] });

  return send(res, 404, { message: `Ruta simulada no implementada: ${req.method} ${path}` });
});

server.listen(PORT, () => console.log(`API simulada de APEXOS en http://localhost:${PORT}/api/v1  (modo: ${mode})`));
