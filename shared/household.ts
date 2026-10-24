import type { Answers, Device, Household, HouseholdPreset, Profile, ResolveResult, Rule } from './types'

/**
 * How the household changes. Each function takes the current household and returns the next one;
 * app-api stores the result in its database, mockClient.ts in localStorage.
 */

export const blankHousehold = (): Household => ({ devices: [], saved: [], answers: null, preset_id: null, rules: [], profile: null })

/**
 * A stored household in today's shape. Households saved before presets (answers to the old questionnaire,
 * "Ask me first" rules, per-flow decisions) go back to the onboarding questions. Their custom allow and never
 * rules stay; "Ask me first" rules are dropped, since the household is no longer asked and its preset decides.
 */
export function normalizeHousehold(raw: Partial<Household> & Record<string, unknown>): Household {
  const { decisions: _d, group_decisions: _g, ...rest } = raw
  const h: Household = { ...blankHousehold(), ...rest }
  const rules = h.rules.filter((r) => (r.effect as string) !== 'ask')
  if (!('preset_id' in raw)) return { ...h, answers: null, preset_id: null, rules: rules.filter((r) => r.origin.kind === 'custom') }
  return { ...h, rules }
}

/** The fixture household (public/mock/household.json): Reolink "just joined", the others have been in the home for a day. */
export function seedHousehold(fixture: { devices: { device_id: string; added_at: string }[] }, now = Date.now()): Household {
  return {
    ...blankHousehold(),
    devices: fixture.devices.map((d) => ({
      ...d,
      added_at: new Date(now - (d.device_id === 'reolink-e1-zoom' ? 2 * 60_000 : 86_400_000)).toISOString(),
      joined_seen: d.device_id !== 'reolink-e1-zoom',
    })),
  }
}

/** Takes the preset's rules in place of the previous preset's. Rules the person added stay, after them. */
export function choosePreset(h: Household, preset: HouseholdPreset, answers?: Answers): Household {
  const rules: Rule[] = preset.rules.map((r) => ({ ...r, origin: { kind: 'preset', preset_id: preset.id } }))
  return {
    ...h,
    preset_id: preset.id,
    answers: answers ?? h.answers ?? {},
    rules: [...rules, ...h.rules.filter((r) => r.origin.kind === 'custom')],
  }
}

export const saveProfile = (h: Household, profile: Profile): Household => ({ ...h, profile })

export function upsertRule(h: Household, rule: Rule): Household {
  const exists = h.rules.some((r) => r.id === rule.id)
  return { ...h, rules: exists ? h.rules.map((r) => (r.id === rule.id ? rule : r)) : [...h.rules, rule] }
}

export const deleteRule = (h: Household, id: string): Household => ({ ...h, rules: h.rules.filter((r) => r.id !== id) })

export function addDevice(h: Household, id: string, opts?: { joined?: boolean }, now = new Date()): Household {
  if (h.devices.some((d) => d.device_id === id)) return h
  return {
    ...h,
    saved: h.saved.filter((s) => s !== id),
    devices: [...h.devices, { device_id: id, added_at: now.toISOString(), joined_seen: !opts?.joined }],
  }
}

export const removeDevice = (h: Household, id: string): Household => ({ ...h, devices: h.devices.filter((d) => d.device_id !== id) })

export const saveForLater = (h: Household, id: string): Household => ({ ...h, saved: h.saved.includes(id) ? h.saved : [...h.saved, id] })

export const markJoinedSeen = (h: Household, id: string): Household => ({
  ...h,
  devices: h.devices.map((d) => (d.device_id === id ? { ...d, joined_seen: true } : d)),
})

/** The fixture declarations have fixed dates; make them relative to now so the demo never looks stale. */
export function withFreshDeclaration(d: Device, now = Date.now()): Device {
  if (!d.declaration) return d
  return { ...d, declaration: { ...d.declaration, received_at: new Date(now - 2 * 60_000).toISOString(), renew_by: new Date(now + 7 * 86_400_000).toISOString() } }
}

/** Turns the text from a scanned (or typed) privacy code into a device, using the code table in public/mock/codes.json. */
export function resolveCode(payload: string, codes: Record<string, string>): ResolveResult {
  const text = payload.trim()
  if (!text) return { ok: false, reason: 'not_a_code' }
  if (/^MT:/i.test(text) || /^\d{11}$|^\d{4}-\d{3}-\d{4}$/.test(text)) return { ok: false, reason: 'matter_code' }
  // Accept the full URL, "ppd:<id>", or the bare declaration id.
  const id = text.replace(/^ppd:/i, '').replace(/^https?:\/\/[^/]+\/d\//i, '')
  const hit = codes[text] ?? Object.entries(codes).find(([url]) => url.endsWith('/' + id))?.[1]
  return hit ? { ok: true, device_id: hit } : { ok: false, reason: /^[a-z0-9:/._-]+$/i.test(text) ? 'unknown_code' : 'not_a_code' }
}
