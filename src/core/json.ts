/**
 * Lectores tolerantes de JSON (port de `lib/core/json.dart`).
 *
 * La API devuelve números como number o texto según el driver de
 * Prisma/Postgres; todo el parseo pasa por aquí para no reventar en runtime.
 */
export type Json = Record<string, unknown>;

export function asInt(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function asIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = asInt(v, Number.NaN);
  return Number.isNaN(n) ? null : n;
}

export function asDouble(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function asDoubleOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = asDouble(v, Number.NaN);
  return Number.isNaN(n) ? null : n;
}

export function asString(v: unknown, fallback = ''): string {
  return v === null || v === undefined ? fallback : String(v);
}

export function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

export function asDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function asMap(v: unknown): Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
}

export function asMapList(v: unknown): Json[] {
  return Array.isArray(v)
    ? v.filter((e): e is Json => e !== null && typeof e === 'object' && !Array.isArray(e))
    : [];
}

/** `{data: X}` o `X` directo: la API envuelve a veces y a veces no. */
export function unwrapData(v: unknown): Json {
  const m = asMap(v);
  const data = asMap(m.data);
  return Object.keys(data).length === 0 ? m : data;
}

/** Lista desde `[...]`, `{data:[...]}`, `{rows:[...]}` o `{items:[...]}`. */
export function unwrapList(v: unknown): Json[] {
  if (Array.isArray(v)) return asMapList(v);
  const m = asMap(v);
  for (const k of ['data', 'rows', 'items']) {
    if (Array.isArray(m[k])) return asMapList(m[k]);
  }
  return [];
}
