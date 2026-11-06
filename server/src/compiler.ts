import { createHash } from 'node:crypto'
import { conditionConstraints, conditionOf, decidingRule } from '../../shared/scope'
import { CORE_TERMS, FIELDS, TAXONOMY_RELEASE, checkDataflow, type Constraints, type Field } from '../../shared/taxonomy'
import type { CompiledRule, Device, Household, Policy, PolicyRule, PublishPreview, Rule, Taxonomy } from '../../shared/types'
import { tupleKey } from './live'

/**
 * Compiles the household policy into the policy rules every device receives (draft-dsmullen-ppd-protocol-04
 * sections 7.10-7.11). One policy for the whole home, the same for every device, as the CableLabs gateway serves it.
 *
 * - Every policy rule is atomic: one core term for each of the five fields, and allow or deny.
 * - The policy covers every core dataflow the household policy has an answer for (up to 6,272 in
 *   ppd-core-2026-05), not only what devices declared. A device that declares nothing still gets rules for
 *   whatever it does, and finds them by its own dataflows.
 * - The household's answer for a dataflow is the latest-changed enabled rule that covers it (Nov 2 meeting: the
 *   latest rule wins; shared/scope.ts decidingRule). A dataflow no rule covers gets no policy rule: there is no
 *   default outside the household's rules (the draft defines none).
 * - Declarations do not shape the policy. They only say which policy rules match which device flows, for the app's
 *   display. One exception: a household rule scoped to a qualifier the device declares (such as "kept forever")
 *   can only match a declared flow, so it is applied to that flow's dataflow when it is the later rule.
 * - Constraints come only from a household condition ("Allowed only if", protocol-04 section 7.12). Only
 *   qualifiers valid for the action are emitted (processing_boundary only on use and inference).
 */

/** A rule's answer for a dataflow, and the rule's place in the household's list (later = changed more recently). */
type Choice = { effect: 'allow' | 'deny'; reason: string; constraints?: Constraints; order: number }

function ruleChoice(t: Taxonomy, rules: Rule[]): Choice | null {
  const rule = decidingRule(rules, t)
  if (!rule) return null
  const order = rules.indexOf(rule)
  const reason = `Your rule “${rule.title}”`
  if (rule.effect === 'dont_allow') return { effect: 'deny', reason, order }
  const c = conditionOf(rule)
  return c ? { effect: 'allow', reason, constraints: conditionConstraints(c), order } : { effect: 'allow', reason, order }
}

/** Keeps only qualifiers the taxonomy defines for this action. */
function validConstraints(action: string, c: Constraints | undefined): Constraints | undefined {
  if (!c) return undefined
  const out: Constraints = {}
  if (c.retention) out.retention = c.retention
  if (c.processing_boundary && (action === 'ppd:use' || action === 'ppd:inference')) out.processing_boundary = c.processing_boundary
  if (c.jurisdiction) out.jurisdiction = c.jurisdiction
  return Object.keys(out).length ? out : undefined
}

const sameConstraints = (a: Constraints | undefined, b: Constraints | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
const ruleId = (key: string) => 'r-' + createHash('sha256').update(key).digest('hex').slice(0, 10)

/** Every core dataflow: each combination of the five fields' core terms. */
export const CORE_DATAFLOWS: Record<Field, string>[] = FIELDS.reduce<Record<Field, string>[]>(
  (acc, f) => acc.flatMap((partial) => Object.keys(CORE_TERMS[f]).map((term) => ({ ...partial, [f]: term }))),
  [{} as Record<Field, string>],
)

export function compileHouseholdPolicy(household: Household, devices: Device[], published: Policy | null): { preview: PublishPreview; policy: Omit<Policy, 'policy_id'> } {
  const groups = new Map<string, { fields: Record<Field, string>; choices: Choice[]; flows: CompiledRule['flows'] }>()
  const warnings: string[] = []

  // The household policy itself: its answer for every core dataflow.
  for (const fields of CORE_DATAFLOWS) {
    const choice = ruleChoice({ ...fields, constraints: {} }, household.rules)
    if (choice) groups.set(tupleKey(fields), { fields, choices: [choice], flows: [] })
  }

  // Declared flows: which policy rule each one matches, for the app's display.
  for (const device of devices) {
    for (const flow of device.flows) {
      const problems = checkDataflow(flow.id, flow.taxonomy)
      if (problems.length) {
        warnings.push(`${device.short_name}: “${flow.title}” matches no policy rule because ${problems[0].message}.`)
        continue
      }
      const key = tupleKey(flow.taxonomy)
      const choice = ruleChoice(flow.taxonomy, household.rules)
      const g = groups.get(key) ?? (choice ? { fields: Object.fromEntries(FIELDS.map((f) => [f, flow.taxonomy[f]])) as Record<Field, string>, choices: [], flows: [] } : undefined)
      if (!g) continue
      if (choice) g.choices.push(choice)
      g.flows.push({ device_id: device.id, flow_id: flow.id, title: flow.title })
      groups.set(key, g)
    }
  }

  const before = new Map((published?.rules ?? []).map((r) => [tupleKey(r), r]))
  const rules: CompiledRule[] = []
  for (const [key, g] of groups) {
    // The dataflow's own answer, and a declared flow's (which can also meet a rule scoped to a declared qualifier): the later rule wins.
    const latest = g.choices.reduce((a, b) => (b.order > a.order ? b : a))
    const constraints = validConstraints(g.fields.action, latest.effect === 'allow' ? latest.constraints : undefined)
    const rule: PolicyRule = { rule_id: ruleId(key), ...g.fields, effect: latest.effect, ...(constraints ? { constraints } : {}) }
    const old = before.get(key)
    const change = !old ? 'added' : old.effect !== rule.effect || !sameConstraints(old.constraints, rule.constraints) ? 'changed' : 'unchanged'
    rules.push({ ...rule, reason: latest.reason, flows: g.flows, change, limited: !!constraints })
  }
  rules.sort((a, b) => a.rule_id.localeCompare(b.rule_id))

  const removed = [...before.entries()].filter(([key]) => !groups.has(key)).map(([, r]) => r)

  const policy: Omit<Policy, 'policy_id'> = {
    taxonomy: { release: TAXONOMY_RELEASE },
    scope: 'home',
    rules: rules.map(({ reason: _r, flows: _f, change: _c, limited: _l, ...rule }) => rule),
  }
  return { preview: { base_policy_id: published?.policy_id ?? null, rules, removed, warnings, devices: devices.length }, policy }
}

/** A new, sortable policy instance id for an explicit publication. */
export function newPolicyId(now = new Date()): string {
  return 'household-' + now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
}
