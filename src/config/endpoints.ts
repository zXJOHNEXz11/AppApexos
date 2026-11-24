/**
 * Rutas de la API de APEXOS.
 *
 * Copiadas 1:1 de `lib/config/api_config.dart` de la app Flutter, que a su vez
 * salen de `apps/api/src/modules/services/routes.js`. NO se inventa ninguna.
 * Todo cuelga de la ORDEN; la solicitud viaja como `item_id` en el cuerpo.
 */
export const Api = {
  // Auth
  login: '/auth/login',
  me: '/auth/me',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  /** Ingreso con la huella registrada en Marcar jornada (reto + firma WebAuthn). */
  webauthnChallenge: '/auth/webauthn/challenge',
  webauthnLogin: '/auth/webauthn/login',

  satisfactionQuestions: '/services/satisfaction-questions',

  // Jornada (talento humano). `/hr/self` resuelve al empleado por el token.
  hrSelf: '/hr/self',
  hrAttendance: '/hr/self/attendance',
  hrTimePunches: '/hr/self/time-punches',
  hrBiometricEnrollment: '/hr/self/biometric-enrollment',
  hrRoutes: '/hr/self/routes',
  hrActivityTypes: '/hr/self/activity-types',
  hrWorkSession: '/hr/self/work-session',
  hrWorkActivities: '/hr/self/work-activities',
  /** Maestro de rostros: rostro propio (registro y embedding para comparar sin señal). */
  hrFaceEnrollment: '/hr/self/face-enrollment',
  /** Huella propia (WebAuthn): registro y llaves activas del usuario. */
  hrWebauthn: '/hr/self/webauthn',

  // Órdenes de servicio
  orders: '/services/orders',
  order: (id: number) => `/services/orders/${id}`,
  startOrder: (id: number) => `/services/orders/${id}/start`,
  inspection: (orderId: number) => `/services/orders/${orderId}/inspection`,
  execution: (orderId: number) => `/services/orders/${orderId}/execution`,
  closeOrder: (id: number) => `/services/orders/${id}/close`,
  itemStatus: (orderId: number, itemId: number) =>
    `/services/orders/${orderId}/items/${itemId}/status`,
  incidents: (orderId: number) => `/services/orders/${orderId}/incidents`,
  /** La que de verdad usa la app hoy: base64 (data URL) dentro de un JSON. */
  photos: (orderId: number) => `/services/orders/${orderId}/photos`,

  // Finanzas (accionista, solo lectura, `accounting:read`)
  balanceSheet: '/accounting/reports/balance-sheet',
  incomeStatement: '/accounting/reports/income-statement',
  trialBalance: '/accounting/reports/trial-balance',
  taxReport: '/accounting/reports/taxes',
  receivables: '/accounting/reports/receivables',
  payables: '/accounting/reports/payables',
  pygInteractive: '/accounting/reports/pyg-interactive',
  pygBudgets: '/accounting/reports/pyg-interactive/budgets',
  pygMapping: '/transport-pyg/mapping',
  pygReport: '/transport-pyg/report',
  accountingPeriods: '/accounting/periods',
  accounts: '/accounting/accounts',
  accountingDocuments: '/accounting/documents',
  ledger: (accountCode: string) => `/accounting/ledger/${encodeURIComponent(accountCode)}`,

  // Transporte (accionista, solo lectura, `transport:read`)
  vehicleMetrics: '/transport/vehicles/metrics/dashboard',
  pygConfig: '/transport-pyg/config',
  settlementTower: '/transport/settlement-control-tower',
  settlementPeriods: '/transport/settlement-periods',
  settlementTypes: '/transport/settlement-types',
  settlementPackage: (id: number) => `/transport/settlement-packages/${id}`,
} as const;

/** Ruta del token de Supabase Auth (`SupabaseConfig.tokenPath`). */
export const SUPABASE_TOKEN_PATH = '/auth/v1/token';
