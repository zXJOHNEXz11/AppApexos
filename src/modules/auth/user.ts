import { asInt, asMap, asString, asStringOrNull, type Json } from '../../core/json';

/**
 * Usuario de la sesión (port de `lib/models/user.dart`). La visibilidad de
 * módulos replica EXACTAMENTE los getters de Flutter.
 */
export interface AppUser {
  id: number;
  name: string;
  email: string;
  roleName: string;
  tenantName: string;
  /** Empresa (tenant_id). Lo necesita el ingreso con huella. */
  tenantId: string;
  permissions: string[];
  roleMetadata: Json;
  /** null = desconocido (no filtra); [] = sin módulos. */
  activeModules: string[] | null;
}

function parsePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const p of raw) {
    if (typeof p === 'string') {
      if (p.trim()) out.add(p.trim().toLowerCase());
    } else if (p && typeof p === 'object') {
      const m = asString((p as Json).module).trim().toLowerCase();
      const a = asString((p as Json).action).trim().toLowerCase();
      if (m && a) out.add(`${m}:${a}`);
    }
  }
  return [...out];
}

function parseModules(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
}

/** Respuesta de login y de `/auth/me`: `{user, tenant}`. */
export function userFromJson(user: Json, tenant: Json): AppUser {
  const role = user.role;
  return {
    id: asInt(user.id),
    name: asString(user.name),
    email: asString(user.email),
    roleName: role && typeof role === 'object' ? asString((role as Json).name) : asString(role),
    tenantName: asString(tenant.name),
    tenantId: asString(user.tenant_id) || asString(tenant.id),
    permissions: parsePermissions(user.role_permissions),
    roleMetadata: asMap(user.role_metadata),
    activeModules: parseModules(tenant.active_modules),
  };
}

const MODULE_ALIASES: Record<string, string[]> = {
  services: ['m-26', 'servicios', 'services'],
  hr: ['m-17', 'talento-humano', 'talento_humano', 'hr'],
  time_tracking: ['m-17', 'talento-humano', 'talento_humano', 'hr', 'time_tracking', 'marcaciones'],
  admin: ['m-22', 'administracion', 'administracion_apex', 'admin'],
  accounting: ['m-07', 'contabilidad', 'finance', 'accounting'],
  transport: ['m-14', 'transporte', 'transport'],
};

const ADMIN_ROLES = new Set([
  'apex admin', 'owner', 'admin', 'superadmin', 'administrador', 'administrador de empresa',
  'administrador empresa', 'admin empresa', 'company admin', 'platform admin',
]);
const SHAREHOLDER_ROLES = new Set(['accionista', 'accionistas', 'shareholder', 'shareholders']);

function normalize(v: unknown): string {
  return asString(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function can(u: AppUser, module: string, action: string): boolean {
  const p = u.permissions;
  return (
    p.includes(`${module}:${action}`) || p.includes(`${module}:*`) || p.includes(`*:${action}`) || p.includes('*:*')
  );
}

export function isAdministrative(u: AppUser): boolean {
  const rm = u.roleMetadata;
  return [u.roleName, rm.role_name, rm.role_type, rm.profile_kind, rm.scope].some((v) =>
    ADMIN_ROLES.has(normalize(v)),
  );
}

export function isShareholder(u: AppUser): boolean {
  const rm = u.roleMetadata;
  return [u.roleName, rm.role_name, rm.role_type, rm.profile_kind, rm.access_profile].some((v) =>
    SHAREHOLDER_ROLES.has(normalize(v)),
  );
}

export function isMarkingOnly(u: AppUser): boolean {
  const rm = u.roleMetadata;
  const ap = asString(rm.access_profile).trim().toLowerCase();
  const pk = asString(rm.profile_kind).trim().toLowerCase();
  return ap === 'marking_only' || pk === 'marking_only' || u.roleName.trim().toLowerCase() === 'empleado marcaciones';
}

export function tenantHas(u: AppUser, module: string): boolean {
  if (u.activeModules === null || isAdministrative(u)) return true;
  const mods = u.activeModules;
  return (MODULE_ALIASES[module] ?? [module]).some((a) => mods.includes(a));
}

export const canSeeFinance = (u: AppUser) =>
  !isMarkingOnly(u) && (isShareholder(u) || isAdministrative(u)) && tenantHas(u, 'accounting') &&
  (isAdministrative(u) || can(u, 'accounting', 'read'));

export const canSeeTransport = (u: AppUser) =>
  !isMarkingOnly(u) && (isShareholder(u) || isAdministrative(u)) && tenantHas(u, 'transport') &&
  (isAdministrative(u) || can(u, 'transport', 'read'));

export const canSeeServices = (u: AppUser) =>
  !isShareholder(u) && !isMarkingOnly(u) && tenantHas(u, 'services') && (isAdministrative(u) || can(u, 'services', 'read'));

export const canMarkAttendance = (u: AppUser) => !isShareholder(u) && tenantHas(u, 'time_tracking');

export function initials(u: AppUser | null): string {
  const parts = (u?.name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0].toUpperCase()).join('');
}

/** Para leer `asStringOrNull` sin importar json en cada pantalla. */
export const displayOr = (v: unknown, fallback = '—') => asStringOrNull(v) ?? fallback;
