import type { Device, DeviceSummary, Household, PpdApi, Questionnaire, ResolveResult, Rule } from './types'

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
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0)
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null
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
}
