import type { Flow, RuleScope } from './types'

/** True when the flow is one the scope describes. Fields left out of the scope match anything. */
export function matchesScope(flow: Flow, scope: RuleScope): boolean {
  const t = flow.taxonomy
  const c = flow.core
  const has = (wanted: string[] | undefined, ...values: string[]) => !wanted?.length || wanted.some((w) => values.includes(w))
  return (
    has(scope.data_type, c.data_type, t.data_type) &&
    has(scope.purpose, c.purpose, t.purpose) &&
    has(scope.handling_context, c.handling_context, t.handling_context) &&
    has(scope.action, c.action, t.action) &&
    (scope.constraints ?? []).every((k) => t.constraints.includes(k))
  )
}

/** A flow "leaves the home" when a company (the maker, its services, or someone else) handles it. */
export const leavesHome = (flow: Flow) => flow.core.handling_context !== 'ppd:householdContext'
