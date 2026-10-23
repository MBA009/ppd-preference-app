import type { Device, DeviceSummary, Household, Overview, PpdApi, Questionnaire } from './types'
import { evaluateDevice } from '../../shared/engine'
import * as hh from '../../shared/household'

/**
 * Offline stand-in for app-api, used when VITE_API_MODE=mock. Reads the static JSON in public/mock/ and
 * keeps the household in localStorage so it survives reloads. The household changes and the verdicts
 * come from shared/, the same code app-api runs.
 */

const BASE = import.meta.env.BASE_URL + 'mock/'
const LATENCY_MS = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 120) // set to 0 to remove the fake delay
const STORE_KEY = 'ppd.household.v1'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const cache = new Map<string, Promise<unknown>>()

async function getJson<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(path)) // do not cache failures
    cache.set(path, p)
  }
  await sleep(LATENCY_MS)
  return (await p) as T
}

/** Mock mode has no gateway: operator views report that, and actions that need one explain why they cannot run. */
const offline = () => Promise.reject(new Error('This needs the PPD gateway, which is not available in offline mode.'))
const noGateway: Overview = {
  gateway: { reachable: false, security: 'unknown', mutual_tls_required: false, tls_enabled: false, freshness_interval: null, error: 'offline mode' },
  counts: { known: 0, registered: 0, declared: 0, policy_retrieved: 0, acknowledged: 0, associated: 0, needs_reassociation: 0, stale: 0, broken: 0, policy_conflict: 0, overrides: 0, authenticated: 0, compatibility_mode: 0, network_observed: 0, unmanaged: 0, need_attention: 0 },
  household_policy: { policy_id: null, updated_at: null, published_by_app: false },
  updated_at: new Date().toISOString(),
}

const seed = async () => hh.seedHousehold(await getJson('household.json'))

function read(): Household | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    // Older saves lack the policy fields; fill them in so the person lands on the questions.
    return raw ? { ...hh.blankHousehold(), ...(JSON.parse(raw) as Partial<Household>) } : null
  } catch {
    return null
  }
}

function write(h: Household): Household {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(h))
  } catch {
    /* private mode or storage full: the app still works for this session */
  }
  memory = h
  return h
}

let memory: Household | null = null
async function current(): Promise<Household> {
  return memory ?? read() ?? write(await seed())
}

export const mockClient: PpdApi = {
  getQuestionnaire() {
    return getJson<Questionnaire>('questionnaire.json')
  },
  async listRules() {
    return (await current()).rules
  },
  async savePolicy(p) {
    return write(hh.savePolicy(await current(), p))
  },
  async upsertRule(rule) {
    return write(hh.upsertRule(await current(), rule))
  },
  async deleteRule(id) {
    return write(hh.deleteRule(await current(), id))
  },

  async listLibrary() {
    return (await getJson<{ devices: DeviceSummary[] }>('library.json')).devices.map((d) => ({ ...d, kind: 'research' as const }))
  },
  async getDevice(id) {
    const raw = await getJson<Device>(`devices/${encodeURIComponent(id)}.json`)
    return hh.withFreshDeclaration(evaluateDevice({ ...raw, kind: 'research' }, (await current()).rules))
  },

  async resolveCode(payload) {
    return hh.resolveCode(payload, (await getJson<{ codes: Record<string, string> }>('codes.json')).codes)
  },

  async getHousehold() {
    return current()
  },
  async addDevice(id, opts) {
    return write(hh.addDevice(await current(), id, opts))
  },
  async removeDevice(id) {
    return write(hh.removeDevice(await current(), id))
  },
  async saveForLater(id) {
    return write(hh.saveForLater(await current(), id))
  },
  async markJoinedSeen(id) {
    return write(hh.markJoinedSeen(await current(), id))
  },
  async saveDecision(d) {
    return write(hh.saveDecision(await current(), d))
  },
  async resetDemo(mode) {
    // Both modes return to first launch: no answers and no rules yet.
    return write(mode === 'seed' ? await seed() : hh.blankHousehold())
  },

  getMe: async () => ({ email: 'offline@localhost', role: 'operator', simulator: false }),
  getOverview: async () => ({ ...noGateway, updated_at: new Date().toISOString() }),
  getSystemStatus: async () => ({ checks: [{ id: 'mock', group: 'app', label: 'Offline mode', status: 'warn', detail: 'The app is using its built-in examples, not app-api or the PPD gateway.' }], updated_at: new Date().toISOString() }),
  getPublishedPolicy: async () => null,
  previewPublish: offline,
  publish: offline,
  listPresets: async () => [],
  applyPreset: offline,
  disassociate: offline,
  listCommands: async () => [],
  sendCommand: offline,
  getTelemetry: async () => ({ samples: [], by_purpose: [] }),
  listUnmanaged: async () => [],
  listSimDevices: async () => [],
  simConnect: offline,
  simDisconnect: offline,
  simNetwork: offline,
  simReset: offline,
}
