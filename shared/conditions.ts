import { JURISDICTION_SCOPES, type Constraints } from './taxonomy'
import type { RuleCondition } from './types'

/**
 * The conditions an allow rule can carry: the qualifier families of draft-dsmullen-ppd-taxonomy-05 section 6.7, sent
 * as the rule's Constraints Object (protocol-04 section 7.12). One place for how each one reads and what it covers.
 *
 * - retention: only ppd:ephemeral is a condition (ppd:indefinite sets no limit). Bounded periods ("30 days") are left
 *   to later revisions of the draft, so there is no way to send one yet;
 * - processing_boundary: in the home or on the device; defined only for use and inference (section 6.7.2);
 * - jurisdiction: one scope and ISO 3166 codes (section 6.7.3), written `jurisdiction.<scope>=<code>[,<code>…]`, the
 *   same keys taxonomy.ts constraintKeys uses. The Constraints Object holds one jurisdiction with one scope, so a rule
 *   limits one step. A scope that names an action covers only flows with that action; `storage` (where retained data
 *   is kept) covers every action.
 */

export type JurisdictionScope = (typeof JURISDICTION_SCOPES)[number]

/**
 * The places a household can pick: the drafts' own examples, a country (ISO 3166-1, protocol-04 section 7.12) and a
 * subdivision inside it (ISO 3166-2, taxonomy-05 section 6.7.3: "countrycode=us contains subdivisioncode=us-ca").
 */
export const PLACES: Record<string, string> = { us: 'the United States', 'us-ca': 'California' }

/** What the jurisdiction constrains, as the words before "only in …". */
export const SCOPE_TEXT: Record<JurisdictionScope, string> = {
  storage: 'stored', transfer: 'sent only to companies', collection: 'collected', use: 'used', inference: 'analyzed',
}

const SIMPLE: Record<string, string> = {
  'retention=ppd:ephemeral': 'deleted right after use',
  'processing_boundary=ppd:inHomeOnly': 'processed in your home',
  'processing_boundary=ppd:onDeviceOnly': 'processed on the device',
}

const JURISDICTION = /^jurisdiction\.(collection|use|inference|transfer|storage)=([a-z]{2}(?:-[a-z0-9]{1,3})?(?:,[a-z]{2}(?:-[a-z0-9]{1,3})?)*)$/

export function jurisdictionOf(c: string | null | undefined): { scope: JurisdictionScope; codes: string[] } | null {
  const m = c ? JURISDICTION.exec(c) : null
  return m ? { scope: m[1] as JurisdictionScope, codes: m[2].split(',') } : null
}

export const jurisdictionCondition = (scope: JurisdictionScope, codes: string[]) => `jurisdiction.${scope}=${codes.join(',')}` as RuleCondition

export const isCondition = (c: string): c is RuleCondition => c in SIMPLE || !!jurisdictionOf(c)

const placesText = (codes: string[]) => {
  const names = codes.map((c) => PLACES[c] ?? c.toUpperCase())
  return names.length < 3 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/** The condition without "it is": "deleted right after use", "stored only in the United States". For rule names. */
export function conditionShort(c: RuleCondition): string {
  const j = jurisdictionOf(c)
  if (!j) return SIMPLE[c] ?? c
  return j.scope === 'transfer' ? `sent only to companies in ${placesText(j.codes)}` : `${SCOPE_TEXT[j.scope]} only in ${placesText(j.codes)}`
}

/** How the condition reads after "only if". */
export const conditionText = (c: RuleCondition) => `it is ${conditionShort(c)}`

/** The Constraints Object the condition becomes in the policy. */
export function conditionConstraints(c: RuleCondition): Constraints {
  const j = jurisdictionOf(c)
  if (j) {
    const countrycode = j.codes.filter((x) => !x.includes('-'))
    const subdivisioncode = j.codes.filter((x) => x.includes('-'))
    return { jurisdiction: { scope: j.scope, ...(countrycode.length ? { countrycode } : {}), ...(subdivisioncode.length ? { subdivisioncode } : {}) } }
  }
  const [key, value] = c.split('=') as ['retention' | 'processing_boundary', string]
  return { [key]: value }
}

/** The actions a condition is defined for, or null for every action. */
export function conditionActions(c: RuleCondition | null | undefined): string[] | null {
  if (c?.startsWith('processing_boundary=')) return ['ppd:use', 'ppd:inference']
  const j = jurisdictionOf(c)
  return j && j.scope !== 'storage' ? [`ppd:${j.scope}`] : null
}

/**
 * True when the device's own constraints already meet the condition: the same retention or boundary, or a jurisdiction
 * with the same scope whose every place is one the rule allows (a country contains its subdivisions).
 */
export function declaresCondition(c: RuleCondition, declared: Constraints | undefined): boolean {
  const j = jurisdictionOf(c)
  if (!j) {
    const [key, value] = c.split('=') as ['retention' | 'processing_boundary', string]
    return declared?.[key] === value
  }
  const d = declared?.jurisdiction
  if (!d || d.scope !== j.scope) return false
  const places = [...(d.countrycode ?? []), ...(d.subdivisioncode ?? [])]
  return places.length > 0 && places.every((p) => j.codes.includes(p) || j.codes.includes(p.split('-')[0]))
}
