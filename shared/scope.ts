import { constraintKeys } from './taxonomy'
import type { Flow, RuleScope, Taxonomy } from './types'

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

/** A flow "leaves the home" when a company (the maker, its services, or someone else) handles it. */
export const leavesHome = (flow: Flow) => flow.taxonomy.handling_context !== 'ppd:householdContext'
