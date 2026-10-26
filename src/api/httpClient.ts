import type { Command, Device, DeviceSummary, Household, Me, Overview, Policy, HouseholdPreset, Onboarding, PpdApi, Preset, PublishPreview, PublishResult, ResolveResult, Rule, SimConsole, SimDevice, SystemStatus, Telemetry, UnmanagedDevice } from './types'

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

/**
 * The Cloudflare Access session ran out: the edge answers API calls with a redirect to its login page, which a
 * fetch cannot follow. Reloading the page sends the browser through that login (page loads go to the network
 * first, see vite.config.ts). At most once a minute, so a login that keeps failing cannot loop.
 */
function signInAgain(): void {
  const KEY = 'ppd.signin-reload'
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* storage blocked: still reload once */
  }
  window.location.reload()
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
      // app-api never redirects; a redirect is the sign-in layer in front of it asking the person to log in.
      redirect: 'manual',
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  if (res.type === 'opaqueredirect' || res.status === 401) {
    signInAgain()
    throw new ApiError('Your sign-in has expired. Reload the page to sign in again.', 401)
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null
  if (!res.ok) throw new ApiError((data as { message?: string } | null)?.message ?? `The server returned ${res.status}.`, res.status)
  return data as T
}

const id = encodeURIComponent

export const httpClient: PpdApi = {
  getOnboarding: () => call<Onboarding>('GET', '/onboarding'),
  listHouseholdPresets: () => call<HouseholdPreset[]>('GET', '/household-presets'),
  choosePreset: (p) => call<Household>('PUT', '/household/preset', p),
  saveProfile: (profile) => call<Household>('PUT', '/household/profile', profile),
  listRules: () => call<Rule[]>('GET', '/household/rules'),
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
  getSimConsole: (deviceId) => call<SimConsole>('GET', `/simulator/devices/${id(deviceId)}/console`),
  simAction: (deviceId, action) => call<SimConsole>('POST', `/simulator/devices/${id(deviceId)}/actions`, { action }),
  simClearLog: (deviceId) => call<SimConsole>('POST', `/simulator/devices/${id(deviceId)}/log/clear`, {}),
  simBehavior: (deviceId, mode) => call<SimConsole>('POST', `/simulator/devices/${id(deviceId)}/behavior`, { mode }),
}
