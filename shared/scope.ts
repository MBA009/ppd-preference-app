import { CORE_TERMS, FIELDS, constraintKeys } from './taxonomy'
import { conditionActions } from './conditions'
export { conditionConstraints } from './conditions'
import type { Flow, Rule, RuleCondition, RuleScope, Taxonomy } from './types'

/**
 * True when the dataflow is one the scope describes. Fields left out of the scope match anything.
 * Every term is a core ppd: term, so matching is exact (draft-dsmullen-ppd-taxonomy-05 section 7 needs
 * no broader/narrower resolution between core terms).
 */
export function matchesDataflow(t: Taxonomy, scope: RuleScope): boolean {
  const has = (wanted: string[] | undefined, value: string) => !wanted?.length || wanted.includes(value)
  const keys = constraintKeys(t.constraints)
  return (
    has(scope.data_type, t.data_type) &&
    has(scope.purpose, t.purpose) &&
    has(scope.handling_context, t.handling_context) &&
    has(scope.action, t.action) &&
    has(scope.source, t.source) &&
    (scope.constraints ?? []).every((k) => keys.includes(k))
  )
}

export const matchesScope = (flow: Flow, scope: RuleScope) => matchesDataflow(flow.taxonomy, scope)

/** The condition of an allow rule, if it has one. */
export const conditionOf = (rule: Rule): RuleCondition | null => (rule.effect === 'allow' && rule.condition) || null

/**
 * True when an enabled rule applies to the dataflow. A condition defined only for some actions narrows its rule to
 * them: allowed only in the home or on the device covers use and inference, "sent only to companies in …" covers
 * transfer (shared/conditions.ts).
 */
export function ruleCovers(rule: Rule, t: Taxonomy): boolean {
  if (!rule.enabled || !matchesDataflow(t, rule.scope)) return false
  const actions = conditionActions(conditionOf(rule))
  return !actions || actions.includes(t.action)
}

/**
 * The rule that decides a dataflow: of the enabled rules covering it, the one changed last (Nov 2 meeting: the latest
 * rule wins). The household keeps its rules oldest first, and saving a rule moves it to the end (shared/household.ts),
 * so this is the last covering rule in the list. Null when no rule covers it.
 */
export function decidingRule(rules: Rule[], t: Taxonomy): Rule | null {
  for (let i = rules.length - 1; i >= 0; i--) if (ruleCovers(rules[i], t)) return rules[i]
  return null
}

/** What a rule decides: never, allowed only under its condition, or allowed. Rules that decide the same never conflict. */
export const decisionKey = (r: Rule) => (r.effect === 'dont_allow' ? 'never' : conditionOf(r) ?? 'allow')

/**
 * True when some dataflow could be covered by both rules (both enabled). Each field's terms must intersect; a
 * processing-boundary condition narrows its rule to use and inference. Constraint filters are left out: one flow can
 * declare several constraints, so they never keep two rules apart.
 */
export function rulesOverlap(a: Rule, b: Rule): boolean {
  if (!a.enabled || !b.enabled) return false
  const terms = (r: Rule, f: (typeof FIELDS)[number]) => {
    const all = r.scope[f]?.length ? r.scope[f]! : Object.keys(CORE_TERMS[f])
    const actions = f === 'action' ? conditionActions(conditionOf(r)) : null
    return actions ? all.filter((t) => actions.includes(t)) : all
  }
  return FIELDS.every((f) => terms(a, f).some((t) => terms(b, f).includes(t)))
}

/** Every core dataflow (7 × 8 × 4 × 7 × 4 = 6,272, taxonomy-05 sections 6.2–6.6), without constraints. */
export const CORE_FLOWS: Taxonomy[] = FIELDS.reduce<Record<string, string>[]>(
  (acc, f) => acc.flatMap((partial) => Object.keys(CORE_TERMS[f]).map((term) => ({ ...partial, [f]: term }))),
  [{}],
).map((t) => ({ ...t, constraints: {} }) as Taxonomy)

/** The core dataflows no enabled rule decides: the household policy sends devices no rule for them. */
export const undecidedFlows = (rules: Rule[]): Taxonomy[] => {
  const on = rules.filter((r) => r.enabled)
  return CORE_FLOWS.filter((t) => !on.some((r) => ruleCovers(r, t)))
}

/**
 * The scopes that cover exactly the given flows of one situation (data type × purpose × handling context) and nothing
 * else, so an answer for flows with no rule never overrides a rule already deciding part of the situation: the whole
 * situation when all 28 are given, their actions × sources when those form a block, or else one scope per action.
 */
export function gapScopes(situation: Pick<RuleScope, 'data_type' | 'purpose' | 'handling_context'>, flows: Taxonomy[]): RuleScope[] {
  const all = Object.keys(CORE_TERMS.action).length * Object.keys(CORE_TERMS.source).length
  if (flows.length === all) return [situation]
  const byAction = new Map<string, string[]>()
  for (const t of flows) byAction.set(t.action, [...(byAction.get(t.action) ?? []), t.source])
  const sources = [...byAction.values()]
  if (new Set(sources.map((s) => [...s].sort().join())).size === 1) return [{ ...situation, action: [...byAction.keys()], source: sources[0] }]
  return [...byAction].map(([action, source]) => ({ ...situation, action: [action], source }))
}
