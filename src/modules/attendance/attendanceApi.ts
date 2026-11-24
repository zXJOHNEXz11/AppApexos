import { Api } from '../../config/endpoints';
import { asBool, asDate, asInt, asIntOrNull, asMap, asMapList, asString, asStringOrNull, unwrapList } from '../../core/json';
import { todayIso } from '../../core/format';
import { api, canUseCache } from '../../services/apiClient';
import { cachedFetch } from '../../storage/cache';

export type PunchType = 'entrada' | 'inicio_almuerzo' | 'fin_almuerzo' | 'salida';

export const PUNCHES: { type: PunchType; title: string; hint: string; icon: 'fingerprint' | 'food' | 'restore' | 'logout'; gradient: string }[] = [
  { type: 'entrada', title: 'Inicio jornada', hint: 'Marca tu entrada con selfie', icon: 'fingerprint', gradient: 'teal' },
  { type: 'inicio_almuerzo', title: 'Salida almuerzo', hint: 'Disponible después de la entrada', icon: 'food', gradient: 'blue' },
  { type: 'fin_almuerzo', title: 'Retorno almuerzo', hint: 'Disponible después de la salida', icon: 'restore', gradient: 'violet' },
  { type: 'salida', title: 'Fin jornada', hint: 'Disponible al terminar la jornada', icon: 'logout', gradient: 'amber' },
];

/** Orden permitido (igual que `_available` en Flutter). */
export function isAvailable(type: PunchType, marked: Set<PunchType>): boolean {
  switch (type) {
    case 'entrada': return true;
    case 'inicio_almuerzo': return marked.has('entrada');
    case 'fin_almuerzo': return marked.has('inicio_almuerzo');
    case 'salida': return marked.has('entrada');
  }
}

/**
 * Selfie: el backend la exige en entrada y salida (`SELFIE_REQUIRED_TYPES`).
 * En almuerzo es opcional para la web, pero un servidor anterior la exigía en
 * todas; por eso se controla con `VITE_LUNCH_SELFIE_REQUIRED` (por defecto sí).
 */
export const lunchSelfieRequired = import.meta.env.VITE_LUNCH_SELFIE_REQUIRED !== 'false';
export const needsSelfie = (t: PunchType) => t === 'entrada' || t === 'salida' || lunchSelfieRequired;

export interface ServerPunch {
  type: PunchType;
  time: string;
  date: string;
}

export interface WorkRoute {
  id: number;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  vehiclePlate: string | null;
  toleranceMinutes: number;
}

export interface WorkActivity {
  key: string;
  typeName: string;
  observation: string;
  occurredAt: string | null;
  synced: boolean;
}

export interface ActivityType {
  id: number;
  code: string;
  name: string;
}

const KNOWN: PunchType[] = ['entrada', 'inicio_almuerzo', 'fin_almuerzo', 'salida'];

export async function fetchTodayPunches() {
  return cachedFetch(
    `hr:attendance:${todayIso()}`,
    async () => {
      const res = await api.get(Api.hrAttendance, { flat: '1' });
      return unwrapList(res)
        .map((j) => ({
          type: asString(j.tipo ?? j.tipo_marca ?? j.type) as PunchType,
          time: asString(j.hora ?? j.time),
          date: asString(j.fecha ?? j.date),
        }))
        .filter((p) => KNOWN.includes(p.type));
    },
    canUseCache,
  );
}

export async function fetchRoutes() {
  return cachedFetch(
    `hr:routes:${todayIso()}`,
    async () =>
      unwrapList(await api.get(Api.hrRoutes)).map<WorkRoute>((j) => ({
        id: asInt(j.id),
        date: asStringOrNull(j.date),
        startTime: asStringOrNull(j.start_time),
        endTime: asStringOrNull(j.end_time),
        vehiclePlate: asStringOrNull(j.vehicle_plate),
        toleranceMinutes: asIntOrNull(j.tolerance_minutes) ?? 15,
      })),
    canUseCache,
  );
}

export async function fetchWorkSession() {
  return cachedFetch(
    `hr:work-session:${todayIso()}`,
    async () => {
      const m = asMap(await api.get(Api.hrWorkSession));
      return {
        active: asBool(m.active),
        activities: asMapList(m.activities).map<WorkActivity>((j, i) => ({
          key: `s-${asString(j.id, String(i))}`,
          typeName: asStringOrNull(j.activity_type_name) ?? asStringOrNull(asMap(j.activity_type).name) ?? 'Actividad operativa',
          observation: asString(j.observation),
          occurredAt: asDate(j.occurred_at)?.toISOString() ?? null,
          synced: true,
        })),
      };
    },
    canUseCache,
  );
}

export async function fetchActivityTypes() {
  return cachedFetch(
    'hr:activity-types',
    async () =>
      unwrapList(await api.get(Api.hrActivityTypes, { active: 'true' })).map<ActivityType>((j) => ({
        id: asInt(j.id),
        code: asStringOrNull(j.code) ?? String(asInt(j.id)),
        name: asString(j.name),
      })),
    canUseCache,
  );
}

/** "HH:mm" → minutos del día. */
export function minuteOfDay(hhmm: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export const LATE_REASONS: [string, string][] = [
  ['congestion_vial', 'Congestión vial o cierre de vía'],
  ['transporte_publico', 'Falla del transporte público'],
  ['falla_vehiculo', 'Falla mecánica del vehículo'],
  ['cita_medica', 'Cita médica o incapacidad'],
  ['calamidad_domestica', 'Calamidad doméstica'],
  ['clima_seguridad', 'Clima, seguridad o condición externa'],
  ['autorizacion_supervisor', 'Ingreso tardío autorizado por supervisor'],
  ['otro', 'Otro motivo (detallar en el sustento)'],
];

export const EXTENSION_REASONS: [string, string][] = [
  ['entrega_cliente_extendida', 'Entrega extendida por solicitud del cliente'],
  ['congestion_vial', 'Congestión vial o cierre de vía'],
  ['reintento_entrega', 'Reintento de entrega autorizado'],
  ['novedad_operativa', 'Novedad operativa en ruta'],
  ['vehiculo_varado', 'Vehículo varado o falla mecánica'],
  ['cargue_descargue_extendido', 'Cargue o descargue extendido'],
  ['validacion_inventario', 'Validación de inventario o piezas'],
  ['servicio_critico', 'Cierre de servicio crítico'],
  ['autorizacion_supervisor', 'Extensión autorizada por supervisor'],
  ['clima_seguridad', 'Clima, seguridad o condición externa'],
];

export const MILEAGE_RE = /^\d+(\.\d)?$/;
