import { createHash } from 'node:crypto'
import { matchesDataflow } from '../../shared/scope'
import { FIELDS, TAXONOMY_RELEASE, checkDataflow, type Constraints, type Field } from '../../shared/taxonomy'
import type { CompiledRule, Decision, Device, Household, Policy, PolicyRule, PublishPreview, Rule } from '../../shared/types'
import { tupleKey } from './live'

/**
 * Compiles the household's authoring rules into one PPD household policy (draft-dsmullen-ppd-protocol-04
 * section 7.11) for the devices the gateway knows.
 *
 * - Every rule is atomic: the five core fields of one dataflow some device declared, and allow or deny.
 *   Devices match rules on exact core terms, so a rule per declared dataflow is what they can act on.
 * - For each declared flow the household's choice is, in order: a decision the person saved for that flow
 *   (or its group); otherwise the strictest enabled rule that matches (Never, then Ask me first, then
 *   Allowed); otherwise "allow" when the flow stays in the home and "ask" when it leaves it, the same
 *   default the app's verdicts use.
 * - Flows that share one dataflow get one rule; any "never" makes it deny. "Ask me first" is not a
 *   protocol effect: a dataflow still waiting for the person's decision blocks publication.
 * - Constraints come from the declaration; "allow with limits" adds the person's limits. Only qualifiers
 *   valid for the action are emitted (processing_boundary only on use and inference).
 */

type Choice = { effect: 'allow' | 'deny' | 'ask'; reason: string; constraints?: Constraints }

const STRICTNESS = { deny: 2, ask: 1, allow: 0 } as const

function decisionChoice(d: Decision): Choice {
  if (d.preference === 'dont_allow') return { effect: 'deny', reason: 'You chose: Don’t allow' }
  if (d.preference === 'allow') return { effect: 'allow', reason: 'You chose: Allow' }
  const limits: Constraints = {}
  if (d.keep === 'briefly') limits.retention = 'ppd:ephemeral'
  if (d.region === 'United States') limits.jurisdiction = { scope: 'storage', countrycode: ['us'] }
  return { effect: 'allow', reason: 'You chose: Allow with limits', constraints: limits }
}

function ruleChoice(flow: Device['flows'][number], rules: Rule[]): Choice {
  const hits = rules.filter((r) => r.enabled && matchesDataflow(flow.taxonomy, r.scope))
  const first = (effect: Rule['effect']) => hits.find((r) => r.effect === effect)
  const no = first('dont_allow')
  if (no) return { effect: 'deny', reason: `Your rule “${no.title}”` }
  const ask = first('ask')
  if (ask) return { effect: 'ask', reason: `Your rule “${ask.title}” says to ask you` }
  const yes = first('allow')
  if (yes) return { effect: 'allow', reason: `Your rule “${yes.title}”` }
  return flow.taxonomy.handling_context === 'ppd:householdContext'
    ? { effect: 'allow', reason: 'It stays in your home' }
    : { effect: 'ask', reason: 'None of your rules covers this' }
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
  const blocked: PublishPreview['blocked'] = []
  const warnings: string[] = []

  for (const device of devices) {
    for (const flow of device.flows) {
      const problems = checkDataflow(flow.id, flow.taxonomy)
      if (problems.length) {
        warnings.push(`${device.short_name}: “${flow.title}” is left out because ${problems[0].message}.`)
        continue
      }
      const decision = household.decisions[flow.id] ?? household.group_decisions[flow.core_group.id]
      const choice = decision ? decisionChoice(decision) : ruleChoice(flow, household.rules)
      const fields = Object.fromEntries(FIELDS.map((f) => [f, flow.taxonomy[f]])) as Record<Field, string>
      const key = tupleKey(fields)
      const g = groups.get(key) ?? { fields, choices: [], flows: [], declared: [] }
      g.choices.push(choice)
      g.flows.push({ device_id: device.id, flow_id: flow.id, title: flow.title })
      g.declared.push(flow.taxonomy.constraints)
      groups.set(key, g)
      if (choice.effect === 'ask') blocked.push({ device_id: device.id, flow_id: flow.id, title: flow.title, reason: choice.reason })
    }
  }

  const before = new Map((published?.rules ?? []).map((r) => [tupleKey(r), r]))
  const rules: CompiledRule[] = []
  for (const [key, g] of groups) {
    const strictest = g.choices.reduce((a, b) => (STRICTNESS[b.effect] > STRICTNESS[a.effect] ? b : a))
    if (strictest.effect === 'ask') continue
    const limits = g.choices.find((c) => c.effect === 'allow' && c.constraints)?.constraints
    const declared = g.declared.every((c) => sameConstraints(c, g.declared[0])) ? g.declared[0] : undefined
    const constraints = validConstraints(g.fields.action, strictest.effect === 'allow' && limits ? { ...declared, ...limits } : declared)
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
  return { preview: { base_policy_id: published?.policy_id ?? null, rules, removed, blocked, warnings, devices: devices.length }, policy }
}

/** A new, sortable policy instance id for an explicit publication. */
export function newPolicyId(now = new Date()): string {
  return 'household-' + now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-')
}
