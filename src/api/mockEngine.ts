import type { Device, Flow, Rule, Verdict } from './types'
import { leavesHome, matchesScope } from '../policy/scope'

/**
 * STAND-IN for the backend's comparison of a flow with the household's rules.
 * It only exists so the app has real, changing verdicts to show. The real comparison belongs to
 * the backend; replace this file's use in mockClient.ts when that exists.
 *
 * Order of decisions for one flow:
 *   1. No source for the flow yet                         -> indeterminate ("Can't tell")
 *   2. A matching rule says never                         -> unsatisfiable ("Conflicts")
 *   3. A matching rule says ask                           -> decision_required ("Needs your decision")
 *   4. The flow itself declares a limit (on-device only,
 *      in-home only, or not kept)                         -> conditionally_satisfiable ("With limits")
 *   5. A matching rule allows it                          -> compatible ("Matches")
 *   6. Nothing matches: leaves the home -> decision_required, stays at home -> compatible
 * Among rules with the same effect the first one in the policy is cited.
 */

const LIMITS = ['processing_boundary=ppd:onDeviceOnly', 'processing_boundary=ppd:inHomeOnly', 'retention=ppd:ephemeral']
const LIMIT_TEXT: Record<string, string> = {
  'processing_boundary=ppd:onDeviceOnly': 'Fine only because it stays on the device.',
  'processing_boundary=ppd:inHomeOnly': 'Fine only because it stays in your home.',
  'retention=ppd:ephemeral': 'Fine only because it is not kept.',
}

export function evaluateFlow(flow: Flow, rules: Rule[]): Flow['evaluation'] {
  if (flow.evidence === 'needs_source') {
    return { verdict: 'indeterminate', rule_id: null, reason: 'We could not find a source for this flow yet, so we cannot compare it with your rules.' }
  }
  const hits = rules.filter((r) => r.enabled && matchesScope(flow, r.scope))
  const first = (effect: Rule['effect']) => hits.find((r) => r.effect === effect)

  const no = first('dont_allow')
  if (no) return { verdict: 'unsatisfiable', rule_id: no.id, reason: `Your rule “${no.title}” says no to this.` }
  const ask = first('ask')
  if (ask) return { verdict: 'decision_required', rule_id: ask.id, reason: `Your rule “${ask.title}” says to ask you.` }
  const limit = LIMITS.find((l) => flow.taxonomy.constraints.includes(l))
  if (limit) return { verdict: 'conditionally_satisfiable', rule_id: null, reason: LIMIT_TEXT[limit] }
  const yes = first('allow')
  if (yes) return { verdict: 'compatible', rule_id: yes.id, reason: `Your rule “${yes.title}” allows this.` }
  return leavesHome(flow)
    ? { verdict: 'decision_required', rule_id: null, reason: 'None of your rules covers this.' }
    : { verdict: 'compatible', rule_id: null, reason: 'It stays in your home.' }
}

const SEVERITY: Record<Verdict, number> = { unsatisfiable: 0, decision_required: 1, indeterminate: 2, conditionally_satisfiable: 3, compatible: 4 }

/** Evaluates every flow and lists the worst first (the order within a verdict stays as in the declaration). */
export function evaluateDevice(device: Device, rules: Rule[]): Device {
  const flows = device.flows
    .map((f, i) => ({ f: { ...f, evaluation: evaluateFlow(f, rules) }, i }))
    .sort((a, b) => SEVERITY[a.f.evaluation.verdict] - SEVERITY[b.f.evaluation.verdict] || a.i - b.i)
    .map((x) => x.f)
  return { ...device, flows }
}
