import type { Answers, Device, Household, HouseholdPreset, Onboarding, Profile, ResolveResult, Rule } from './types'
import { followUps, rulesFromAnswers, stageOnePath, walk } from './onboarding'
import { named } from './ruleTitle'

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
  const rules = h.rules.filter((r) => (r.effect as string) !== 'ask').map(named)
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

/**
 * Finishes the questionnaire: the answers walk the tree to a leaf (its preset), and the household's rules are rebuilt
 * from that preset with every yes or no to a situation written in (shared/onboarding.ts). Starts over: every earlier
 * rule is replaced, including the person's own edits and rules (the app warns before a rerun). Only answers the
 * questionnaire would have asked are kept: stage 1's path and the leaf's follow-ups.
 */
export function finishOnboarding(h: Household, tree: Onboarding, presets: HouseholdPreset[], answers: Answers): Household {
  const step = walk(tree, answers)
  if (!('leaf' in step)) throw new Error('The answers do not reach the end of the questions yet.')
  const preset = presets.find((p) => p.id === step.leaf.preset)
  if (!preset) throw new Error(`The questions led to a preset this app does not have (${step.leaf.preset}).`)
  const asked = new Set([...stageOnePath(tree, answers), ...followUps(tree, step.leaf, answers)])
  const kept: Answers = Object.fromEntries(Object.entries(answers).filter(([q]) => asked.has(q)))
  return { ...h, preset_id: preset.id, answers: kept, rules: rulesFromAnswers(preset, kept, tree.questions) }
}

/**
 * A household whose preset is no longer in the presets (they were rebuilt) goes back to the questions: its answers
 * and rules came from the old presets. Devices stay.
 */
export function retirePreset(h: Household, presets: HouseholdPreset[]): Household {
  if (!h.preset_id || presets.some((p) => p.id === h.preset_id)) return h
  return { ...h, preset_id: null, answers: null, rules: [] }
}

export const saveProfile = (h: Household, profile: Profile): Household => ({ ...h, profile })

export function upsertRule(h: Household, input: Rule): Household {
  const rule = named(input)
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
