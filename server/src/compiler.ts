import { createHash } from 'node:crypto'
import { conditionConstraints, conditionOf, ruleCovers } from '../../shared/scope'
import { FIELDS, TAXONOMY_RELEASE, checkDataflow, type Constraints, type Field } from '../../shared/taxonomy'
import type { CompiledRule, Device, Household, Policy, PolicyRule, PublishPreview, Rule } from '../../shared/types'
import { tupleKey } from './live'

/**
 * Compiles the household's authoring rules into one PPD household policy (draft-dsmullen-ppd-protocol-04
 * section 7.11) for the devices the gateway knows.
 *
 * - Every rule is atomic: the five core fields of one dataflow some device declared, and allow or deny.
 *   Devices match rules on exact core terms, so a rule per declared dataflow is what they can act on.
 * - For each declared flow the household's choice is the strictest enabled rule that covers it (Never, then
 *   Allowed only if, then Allowed); otherwise "allow" when the flow stays in the home and "deny" when it
 *   leaves it, the same default the app's verdicts use. The household is never asked about single flows.
 * - Flows that share one dataflow get one rule; any "never" makes it deny.
 * - Constraints come from the declaration; an "allowed only if" rule adds its condition (protocol-04
 *   section 7.12). Only qualifiers valid for the action are emitted (processing_boundary only on use and
 *   inference).
 */

type Choice = { effect: 'allow' | 'deny'; reason: string; constraints?: Constraints }

/** Deny, then allow under a condition, then allow. */
const strictness = (c: Choice) => (c.effect === 'deny' ? 2 : c.constraints ? 1 : 0)

function ruleChoice(flow: Device['flows'][number], rules: Rule[]): Choice {
  const hits = rules.filter((r) => ruleCovers(r, flow.taxonomy))
  const no = hits.find((r) => r.effect === 'dont_allow')
  if (no) return { effect: 'deny', reason: `Your rule “${no.title}”` }
  const limited = hits.find((r) => conditionOf(r))
  if (limited) return { effect: 'allow', reason: `Your rule “${limited.title}”`, constraints: conditionConstraints(conditionOf(limited)!) }
  const yes = hits.find((r) => r.effect === 'allow')
  if (yes) return { effect: 'allow', reason: `Your rule “${yes.title}”` }
  return flow.taxonomy.handling_context === 'ppd:householdContext'
    ? { effect: 'allow', reason: 'It stays in your home' }
    : { effect: 'deny', reason: 'None of your rules allows this' }
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

export function compileHouseholdPolicy(household: Household, devices: Device[], published: Policy | null): { preview: PublishPreview; policy: Omit<Policy, 'policy_id'> } {
  const groups = new Map<string, { fields: Record<Field, string>; choices: Choice[]; flows: CompiledRule['flows']; declared: Constraints[] }>()
  const warnings: string[] = []

  for (const device of devices) {
    for (const flow of device.flows) {
      const problems = checkDataflow(flow.id, flow.taxonomy)
      if (problems.length) {
        warnings.push(`${device.short_name}: “${flow.title}” is left out because ${problems[0].message}.`)
        continue
      }
      const choice = ruleChoice(flow, household.rules)
      const fields = Object.fromEntries(FIELDS.map((f) => [f, flow.taxonomy[f]])) as Record<Field, string>
      const key = tupleKey(fields)
      const g = groups.get(key) ?? { fields, choices: [], flows: [], declared: [] }
      g.choices.push(choice)
      g.flows.push({ device_id: device.id, flow_id: flow.id, title: flow.title })
      g.declared.push(flow.taxonomy.constraints)
      groups.set(key, g)
    }
  }

  const before = new Map((published?.rules ?? []).map((r) => [tupleKey(r), r]))
  const rules: CompiledRule[] = []
  for (const [key, g] of groups) {
    const strictest = g.choices.reduce((a, b) => (strictness(b) > strictness(a) ? b : a))
    const declared = g.declared.every((c) => sameConstraints(c, g.declared[0])) ? g.declared[0] : undefined
    const constraints = validConstraints(g.fields.action, strictest.effect === 'allow' && strictest.constraints ? { ...declared, ...strictest.constraints } : declared)
    const rule: PolicyRule = { rule_id: ruleId(key), ...g.fields, effect: strictest.effect, ...(constraints ? { constraints } : {}) }
    const old = before.get(key)
    const change = !old ? 'added' : old.effect !== rule.effect || !sameConstraints(old.constraints, rule.constraints) ? 'changed' : 'unchanged'
    rules.push({ ...rule, reason: strictest.reason, flows: g.flows, change })
  }
  rules.sort((a, b) => a.rule_id.localeCompare(b.rule_id))

  const removed = [...before.entries()].filter(([key]) => !groups.has(key)).map(([, r]) => r)
  if (!devices.length) warnings.push('No device is connected to the gateway, so the policy would have no rules.')

  const policy: Omit<Policy, 'policy_id'> = {
    taxonomy: { release: TAXONOMY_RELEASE },
    scope: 'home',
    rules: rules.map(({ reason: _r, flows: _f, change: _c, ...rule }) => rule),
  }
  return { preview: { base_policy_id: published?.policy_id ?? null, rules, removed, warnings, devices: devices.length }, policy }
}

/** A new, sortable policy instance id for an explicit publication. */
export function newPolicyId(now = new Date()): string {
  return 'household-' + now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
}
