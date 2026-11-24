import { describe, expect, it } from 'vitest';
import { formatCop, formatMonto, formatPct, periodLabel } from '../../core/format';
import { canMarkAttendance, canSeeFinance, canSeeServices, canSeeTransport, initials, userFromJson } from './user';

const make = (user: Record<string, unknown>, tenant: Record<string, unknown> = {}) =>
  userFromJson({ id: 1, name: 'Ana María Pérez', email: 'a@b.co', ...user }, { name: 'Empresa', ...tenant });

describe('visibilidad de módulos (igual que user.dart)', () => {
  it('técnico con services:read ve Servicios y marca jornada, no finanzas', () => {
    const u = make({ role: { name: 'Tecnico' }, role_permissions: [{ module: 'services', action: 'read' }] }, { active_modules: ['m-26', 'm-17'] });
    expect(canSeeServices(u)).toBe(true);
    expect(canMarkAttendance(u)).toBe(true);
    expect(canSeeFinance(u)).toBe(false);
    expect(canSeeTransport(u)).toBe(false);
  });

  it('accionista con accounting:read ve Reportes, nunca Servicios ni marcación', () => {
    const u = make({ role: { name: 'Accionista' }, role_permissions: ['accounting:read'] }, { active_modules: ['contabilidad'] });
    expect(canSeeFinance(u)).toBe(true);
    expect(canSeeTransport(u)).toBe(false);
    expect(canSeeServices(u)).toBe(false);
    expect(canMarkAttendance(u)).toBe(false);
  });

  it('administrador (con tildes/guiones) ve todo aunque el tenant no liste módulos', () => {
    const u = make({ role: 'Administrador_de-Empresa' }, { active_modules: [] });
    expect(canSeeFinance(u)).toBe(true);
    expect(canSeeTransport(u)).toBe(true);
    expect(canSeeServices(u)).toBe(true);
  });

  it('perfil solo-marcación no ve servicios', () => {
    const u = make({ role: { name: 'Empleado marcaciones' }, role_permissions: ['*:*'] });
    expect(canSeeServices(u)).toBe(false);
    expect(canMarkAttendance(u)).toBe(true);
  });

  it('active_modules ausente = no filtrar', () => {
    const u = make({ role: { name: 'tecnico' }, role_permissions: ['services:*'] });
    expect(u.activeModules).toBeNull();
    expect(canSeeServices(u)).toBe(true);
  });

  it('iniciales', () => {
    expect(initials(make({}))).toBe('AM');
    expect(initials(null)).toBe('?');
  });
});

describe('formatos', () => {
  it('COP sin decimales con punto de miles', () => {
    expect(formatCop(150000)).toBe('$ 150.000');
    expect(formatCop(-2500.6)).toBe('-$ 2.501');
    expect(formatMonto(-13052369)).toBe('($ 13.052.369)');
  });
  it('porcentajes con coma', () => {
    expect(formatPct(12.345)).toBe('12,3%');
    expect(formatPct(12)).toBe('12%');
    expect(formatPct(2.25, 2)).toBe('2,25%');
    expect(formatPct(null)).toBe('—');
  });
  it('periodo', () => {
    expect(periodLabel('2026-10')).toBe('octubre de 2026');
  });
});
