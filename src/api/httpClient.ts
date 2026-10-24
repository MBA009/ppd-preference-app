import type { Command, Device, DeviceSummary, Household, Me, Overview, Policy, PpdApi, Preset, PublishPreview, PublishResult, Questionnaire, ResolveResult, Rule, SimDevice, SystemStatus, Telemetry, UnmanagedDevice } from './types'

/**
 * The real backend: app-api (server/), reached on the same origin under /api. In development Vite
 * proxies /api to app-api (see vite.config.ts); in deployment Nginx does.
 */

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

/** An app-api error. `status` is the HTTP status; the message is safe to show. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      // X-PPD-Client marks requests from this app; app-api refuses writes without it (CSRF protection).
      headers: body === undefined ? { Accept: 'application/json', 'X-PPD-Client': 'web' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-PPD-Client': 'web' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null
  if (res.status === 401) throw new ApiError('Your sign-in has expired. Reload the page to sign in again.', 401)
  if (!res.ok) throw new ApiError((data as { message?: string } | null)?.message ?? `The server returned ${res.status}.`, res.status)
  return data as T
}

const id = encodeURIComponent

export const httpClient: PpdApi = {
  getQuestionnaire: () => call<Questionnaire>('GET', '/questionnaire'),
  listRules: () => call<Rule[]>('GET', '/household/rules'),
  savePolicy: (p) => call<Household>('PUT', '/household/policy', p),
  upsertRule: (rule) => call<Household>('PUT', `/household/rules/${id(rule.id)}`, rule),
  deleteRule: (ruleId) => call<Household>('DELETE', `/household/rules/${id(ruleId)}`),

  listLibrary: () => call<DeviceSummary[]>('GET', '/library'),
  getDevice: (deviceId) => call<Device>('GET', `/devices/${id(deviceId)}`),
  resolveCode: (payload) => call<ResolveResult>('POST', '/codes/resolve', { payload }),

  getHousehold: () => call<Household>('GET', '/household'),
  addDevice: (deviceId, opts) => call<Household>('POST', '/household/devices', { device_id: deviceId, joined: opts?.joined ?? false }),
  removeDevice: (deviceId) => call<Household>('DELETE', `/household/devices/${id(deviceId)}`),
  saveForLater: (deviceId) => call<Household>('POST', '/household/saved', { device_id: deviceId }),
  markJoinedSeen: (deviceId) => call<Household>('POST', `/household/devices/${id(deviceId)}/seen`),
  saveDecision: (d) => call<Household>('POST', '/household/decisions', d),
  resetDemo: (mode) => call<Household>('POST', '/household/reset', { mode }),

  getMe: () => call<Me>('GET', '/me'),
  getOverview: () => call<Overview>('GET', '/overview'),
  getSystemStatus: () => call<SystemStatus>('GET', '/system-status'),
  getPublishedPolicy: () => call<Policy | null>('GET', '/household/published'),
  previewPublish: () => call<PublishPreview>('GET', '/household/preview'),
  publish: () => call<PublishResult>('POST', '/household/publish', {}),
  listPresets: () => call<Preset[]>('GET', '/presets'),
  applyPreset: (name) => call<Policy>('POST', `/presets/${id(name)}/apply`, {}),
  disassociate: async (deviceId) => { await call<null>('POST', `/devices/${id(deviceId)}/disassociate`, {}) },
  forgetDevice: (deviceId) => call<Household>('POST', `/devices/${id(deviceId)}/forget`, {}),
  listCommands: (deviceId) => call<Command[]>('GET', `/devices/${id(deviceId)}/commands`),
  sendCommand: (deviceId, action, value) => call<Command>('POST', `/devices/${id(deviceId)}/commands`, value === undefined ? { action } : { action, value }),
  getTelemetry: (deviceId) => call<Telemetry>('GET', `/devices/${id(deviceId)}/telemetry`),
  listUnmanaged: () => call<UnmanagedDevice[]>('GET', '/network'),

  listSimDevices: () => call<SimDevice[]>('GET', '/simulator/devices'),
  simConnect: (deviceId) => call<SimDevice>('POST', `/simulator/devices/${id(deviceId)}/connect`, {}),
  simDisconnect: (deviceId) => call<SimDevice>('POST', `/simulator/devices/${id(deviceId)}/disconnect`, {}),
  simNetwork: (deviceId, present) => call<SimDevice>('POST', `/simulator/devices/${id(deviceId)}/network`, { present }),
  simReset: () => call<SimDevice[]>('POST', '/simulator/reset', {}),
}
