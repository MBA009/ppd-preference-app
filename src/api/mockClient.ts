import type { Decision, Device, DeviceSummary, Household, PpdApi, ResolveResult, Rule } from './types'

/**
 * Backend stand-in. Reads the static JSON in public/mock/ and keeps the household
 * (devices in the home, saved decisions) in localStorage so it survives reloads.
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

async function seed(): Promise<Household> {
  const s = await getJson<{ devices: { device_id: string; added_at: string }[] }>('household.json')
  const now = Date.now()
  return {
    // Reolink "just joined" (2 minutes ago, not yet reviewed); the others have been in the home for a day.
    devices: s.devices.map((d) => ({
      ...d,
      added_at: new Date(now - (d.device_id === 'reolink-e1-zoom' ? 2 * 60_000 : 86_400_000)).toISOString(),
      joined_seen: d.device_id !== 'reolink-e1-zoom',
    })),
    saved: [],
    decisions: {},
    group_decisions: {},
  }
}

function read(): Household | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Household) : null
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
  async listRules() {
    return (await getJson<{ rules: Rule[] }>('rules.json')).rules
  },
  async listLibrary() {
    return (await getJson<{ devices: DeviceSummary[] }>('library.json')).devices
  },
  async getDevice(id) {
    const d = await getJson<Device>(`devices/${encodeURIComponent(id)}.json`)
    if (!d.declaration) return d
    // The fixture has fixed dates; make them relative to now so the demo never looks stale.
    const now = Date.now()
    return { ...d, declaration: { ...d.declaration, received_at: new Date(now - 2 * 60_000).toISOString(), renew_by: new Date(now + 7 * 86_400_000).toISOString() } }
  },

  async resolveCode(payload): Promise<ResolveResult> {
    const text = payload.trim()
    if (!text) return { ok: false, reason: 'not_a_code' }
    if (/^MT:/i.test(text) || /^\d{11}$|^\d{4}-\d{3}-\d{4}$/.test(text)) return { ok: false, reason: 'matter_code' }
    const { codes } = await getJson<{ codes: Record<string, string> }>('codes.json')
    // Accept the full URL, "ppd:<id>", or the bare declaration id.
    const id = text.replace(/^ppd:/i, '').replace(/^https?:\/\/[^/]+\/d\//i, '')
    const hit = codes[text] ?? Object.entries(codes).find(([url]) => url.endsWith('/' + id))?.[1]
    return hit ? { ok: true, device_id: hit } : { ok: false, reason: /^[a-z0-9:/._-]+$/i.test(text) ? 'unknown_code' : 'not_a_code' }
  },

  async getHousehold() {
    return current()
  },
  async addDevice(id, opts) {
    const h = await current()
    if (h.devices.some((d) => d.device_id === id)) return h
    return write({
      ...h,
      saved: h.saved.filter((s) => s !== id),
      devices: [...h.devices, { device_id: id, added_at: new Date().toISOString(), joined_seen: !opts?.joined }],
    })
  },
  async removeDevice(id) {
    const h = await current()
    const decisions = Object.fromEntries(Object.entries(h.decisions).filter(([, d]) => d.device_id !== id))
    return write({ ...h, devices: h.devices.filter((d) => d.device_id !== id), decisions })
  },
  async saveForLater(id) {
    const h = await current()
    return write({ ...h, saved: h.saved.includes(id) ? h.saved : [...h.saved, id] })
  },
  async markJoinedSeen(id) {
    const h = await current()
    return write({ ...h, devices: h.devices.map((d) => (d.device_id === id ? { ...d, joined_seen: true } : d)) })
  },
  async saveDecision(d) {
    const h = await current()
    const decision: Decision = { ...d, decided_at: new Date().toISOString() }
    return write({
      ...h,
      decisions: { ...h.decisions, [d.flow_id]: decision },
      group_decisions: d.remember_similar
        ? { ...h.group_decisions, [d.core_group_id]: decision }
        : Object.fromEntries(Object.entries(h.group_decisions).filter(([k]) => k !== d.core_group_id)),
    })
  },
  async resetDemo(mode) {
    return write(mode === 'seed' ? await seed() : { devices: [], saved: [], decisions: {}, group_decisions: {} })
  },
}
