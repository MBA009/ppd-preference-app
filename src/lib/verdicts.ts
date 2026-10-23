import type { Device, Flow, Household, Verdict } from '../api'

export interface VerdictMeta {
  /** CSS colour class (.ok .lim .dec .bad .unk). */
  cls: 'ok' | 'lim' | 'dec' | 'bad' | 'unk'
  /** The full label, as in the verdict reference board. */
  label: string
  /** Tile colour used on the flow detail banner. */
  tile: 'green' | 'blue' | 'orange' | 'grey' | 'red'
  chip: (n: number) => string
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  unsatisfiable: { cls: 'bad', label: 'Conflicts with your rules', tile: 'red', chip: (n) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}` },
  decision_required: { cls: 'dec', label: 'Needs your decision', tile: 'orange', chip: (n) => `${n} ${n === 1 ? 'needs' : 'need'} a decision` },
  indeterminate: { cls: 'unk', label: 'Not described in terms we can read', tile: 'grey', chip: (n) => `${n} not readable` },
  conditionally_satisfiable: { cls: 'lim', label: 'With limits', tile: 'blue', chip: (n) => `${n} with limits` },
  compatible: { cls: 'ok', label: 'Matches your rules', tile: 'green', chip: (n) => `${n} ${n === 1 ? 'matches' : 'match'}` },
}

/** Chip order everywhere: worst first. */
export const VERDICT_ORDER: Verdict[] = ['unsatisfiable', 'decision_required', 'indeterminate', 'conditionally_satisfiable', 'compatible']

/** A saved preference for a flow, or for its whole core rule group. */
export function decisionFor(flow: Flow, h: Household | null) {
  return h?.decisions[flow.id] ?? h?.group_decisions[flow.core_group.id]
}

export const isPending = (flow: Flow, h: Household | null) =>
  flow.evaluation.verdict === 'decision_required' && !decisionFor(flow, h)

/**
 * Flows that need the person's attention: conflicts and undecided decisions. A flow we can't read
 * (indeterminate) is never one of them: describing it correctly is the vendor's job, we assume nothing about
 * it, and the household is never asked (CableLabs guidance, docs/cablelabs-guidance-vendor-terms-plan.md).
 */
export function needsAttention(flow: Flow, h: Household | null) {
  const v = flow.evaluation.verdict
  return v === 'unsatisfiable' || isPending(flow, h)
}

/**
 * Verdict counts for the chips. Decisions the person has already made leave the
 * "need a decision" count (they are tracked by decidedCount instead).
 */
export function countVerdicts(device: Device, h: Household | null): Partial<Record<Verdict, number>> {
  const out: Partial<Record<Verdict, number>> = {}
  for (const f of device.flows) {
    if (f.evaluation.verdict === 'decision_required' && !isPending(f, h)) continue
    out[f.evaluation.verdict] = (out[f.evaluation.verdict] ?? 0) + 1
  }
  return out
}

export const decidedCount = (device: Device, h: Household | null) =>
  device.flows.filter((f) => f.evaluation.verdict === 'decision_required' && !isPending(f, h)).length

export const pendingFlows = (device: Device, h: Household | null) => device.flows.filter((f) => isPending(f, h))

export const PREFERENCE_LABEL = { allow: 'Allow', allow_with_limits: 'Allow with limits', dont_allow: 'Don’t allow' } as const

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
