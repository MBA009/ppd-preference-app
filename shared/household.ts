import type { Answers, Decision, Device, Household, Profile, ResolveResult, Rule } from './types'

/**
 * How the household changes. Each function takes the current household and returns the next one;
 * app-api stores the result in its database, mockClient.ts in localStorage.
 */

export const blankHousehold = (): Household => ({ devices: [], saved: [], decisions: {}, group_decisions: {}, answers: null, rules: [], profile: null })

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

export const savePolicy = (h: Household, p: { answers: Answers; rules: Rule[]; profile: Profile }): Household => ({ ...h, answers: p.answers, rules: p.rules, profile: p.profile })

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

export function removeDevice(h: Household, id: string): Household {
  const decisions = Object.fromEntries(Object.entries(h.decisions).filter(([, d]) => d.device_id !== id))
  return { ...h, devices: h.devices.filter((d) => d.device_id !== id), decisions }
}

export const saveForLater = (h: Household, id: string): Household => ({ ...h, saved: h.saved.includes(id) ? h.saved : [...h.saved, id] })

export const markJoinedSeen = (h: Household, id: string): Household => ({
  ...h,
  devices: h.devices.map((d) => (d.device_id === id ? { ...d, joined_seen: true } : d)),
})

export function saveDecision(h: Household, d: Omit<Decision, 'decided_at'>, now = new Date()): Household {
  const decision: Decision = { ...d, decided_at: now.toISOString() }
  return {
    ...h,
    decisions: { ...h.decisions, [d.flow_id]: decision },
    group_decisions: d.remember_similar
      ? { ...h.group_decisions, [d.core_group_id]: decision }
      : Object.fromEntries(Object.entries(h.group_decisions).filter(([k]) => k !== d.core_group_id)),
  }
}

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
