import { CORE_TERMS, FIELDS, constraintKeys, type Constraints } from './taxonomy'
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

/** The actions a processing-boundary qualifier is defined for (taxonomy-05 section 6.7.2). */
export const BOUNDARY_ACTIONS = ['ppd:use', 'ppd:inference']

/** The condition of an allow rule, if it has one. */
export const conditionOf = (rule: Rule): RuleCondition | null => (rule.effect === 'allow' && rule.condition) || null

/**
 * True when an enabled rule applies to the dataflow. A rule allowed only in the home or on the device
 * applies only to use and inference: the qualifier means nothing for other actions.
 */
export function ruleCovers(rule: Rule, t: Taxonomy): boolean {
  if (!rule.enabled || !matchesDataflow(t, rule.scope)) return false
  const c = conditionOf(rule)
  return !c?.startsWith('processing_boundary=') || BOUNDARY_ACTIONS.includes(t.action)
}

/** The Constraints Object a rule condition becomes in the policy. */
export function conditionConstraints(c: RuleCondition): Constraints {
  const [key, value] = c.split('=') as ['retention' | 'processing_boundary', string]
  return { [key]: value }
}

/** A flow "leaves the home" when a company (the maker, its services, or someone else) handles it. */
export const leavesHome = (flow: Flow) => flow.taxonomy.handling_context !== 'ppd:householdContext'

/** Never, then allowed only if, then allowed: the order in which disagreeing rules win. */
export const strictness = (r: Rule) => (r.effect === 'dont_allow' ? 2 : conditionOf(r) ? 1 : 0)

/**
 * True when some dataflow could be covered by both rules (both enabled). Each field's terms must intersect; a
 * processing-boundary condition narrows its rule to use and inference. Constraint filters are left out: one flow can
 * declare several constraints, so they never keep two rules apart.
 */
export function rulesOverlap(a: Rule, b: Rule): boolean {
  if (!a.enabled || !b.enabled) return false
  const terms = (r: Rule, f: (typeof FIELDS)[number]) => {
    const all = r.scope[f]?.length ? r.scope[f]! : Object.keys(CORE_TERMS[f])
    return f === 'action' && conditionOf(r)?.startsWith('processing_boundary=') ? all.filter((t) => BOUNDARY_ACTIONS.includes(t)) : all
  }
  return FIELDS.every((f) => terms(a, f).some((t) => terms(b, f).includes(t)))
}
