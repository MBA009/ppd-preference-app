import type { Device, Flow, Rule, Verdict } from './types'
import { conditionOf, leavesHome, ruleCovers } from './scope'
import { checkDataflow, constraintKeys } from './taxonomy'

/**
 * The comparison of a flow with the household's rules. app-api runs it on every device read;
 * mockClient.ts runs the same code in the browser when the app is offline.
 *
 * Order of decisions for one flow:
 *   1. No source for the flow yet, or a term that is not
 *      a core ppd: term                                   -> indeterminate (shown, never asked about)
 *   2. A matching rule says never                         -> unsatisfiable ("Conflicts")
 *   3. A matching rule allows it only under a condition
 *      (not kept, in the home, on the device)             -> conditionally_satisfiable ("With limits")
 *   4. The flow itself declares a limit (on-device only,
 *      in-home only, or not kept)                         -> conditionally_satisfiable ("With limits")
 *   5. A matching rule allows it                          -> compatible ("Matches")
 *   6. Nothing matches: stays at home -> compatible, leaves the home -> unsatisfiable (devices are told no)
 * The household is never asked about a single flow: its preset and rules decide (CableLabs guidance).
 * Among rules with the same effect the first one in the policy is cited.
 */

const LIMITS = ['processing_boundary=ppd:onDeviceOnly', 'processing_boundary=ppd:inHomeOnly', 'retention=ppd:ephemeral']
const LIMIT_TEXT: Record<string, string> = {
  'processing_boundary=ppd:onDeviceOnly': 'Fine only because it stays on the device.',
  'processing_boundary=ppd:inHomeOnly': 'Fine only because it stays in your home.',
  'retention=ppd:ephemeral': 'Fine only because it is not kept.',
}
/** How a rule condition reads after "only if". */
export const CONDITION_TEXT: Record<string, string> = {
  'processing_boundary=ppd:onDeviceOnly': 'it is processed on the device',
  'processing_boundary=ppd:inHomeOnly': 'it is processed in your home',
  'retention=ppd:ephemeral': 'it is not kept',
}

export function evaluateFlow(flow: Flow, rules: Rule[]): Flow['evaluation'] {
  if (flow.evidence === 'needs_source') {
    return { verdict: 'indeterminate', rule_id: null, reason: 'We could not find a source for this flow yet, so we cannot compare it with your rules.' }
  }
  // An unresolvable term is not guessed at (draft-dsmullen-ppd-taxonomy-05 section 11).
  if (checkDataflow(flow.id, flow.taxonomy).length) {
    return { verdict: 'indeterminate', rule_id: null, reason: 'This flow uses terms outside the PPD core taxonomy, so we cannot compare it with your rules.' }
  }
  const hits = rules.filter((r) => ruleCovers(r, flow.taxonomy))
  const no = hits.find((r) => r.effect === 'dont_allow')
  if (no) return { verdict: 'unsatisfiable', rule_id: no.id, reason: `Your rule “${no.title}” says no to this.` }
  const keys = constraintKeys(flow.taxonomy.constraints)
  const limited = hits.find((r) => conditionOf(r))
  if (limited) {
    const c = conditionOf(limited)!
    const said = keys.includes(c) ? ' The device says it is.' : ' Your devices are told so.'
    return { verdict: 'conditionally_satisfiable', rule_id: limited.id, reason: `Your rule “${limited.title}” allows this only if ${CONDITION_TEXT[c]}.${said}` }
  }
  const limit = LIMITS.find((l) => keys.includes(l))
  if (limit) return { verdict: 'conditionally_satisfiable', rule_id: null, reason: LIMIT_TEXT[limit] }
  const yes = hits.find((r) => r.effect === 'allow')
  if (yes) return { verdict: 'compatible', rule_id: yes.id, reason: `Your rule “${yes.title}” allows this.` }
  return leavesHome(flow)
    ? { verdict: 'unsatisfiable', rule_id: null, reason: 'None of your rules allows this, so your devices are told no.' }
    : { verdict: 'compatible', rule_id: null, reason: 'It stays in your home.' }
}

const SEVERITY: Record<Verdict, number> = { unsatisfiable: 0, indeterminate: 1, conditionally_satisfiable: 2, compatible: 3 }

/** Evaluates every flow and lists the worst first (the order within a verdict stays as in the declaration). */
export function evaluateDevice(device: Device, rules: Rule[]): Device {
  const flows = device.flows
    .map((f, i) => ({ f: { ...f, evaluation: evaluateFlow(f, rules) }, i }))
    .sort((a, b) => SEVERITY[a.f.evaluation.verdict] - SEVERITY[b.f.evaluation.verdict] || a.i - b.i)
    .map((x) => x.f)
  return { ...device, flows }
}

/**
 * Flows that need the person's attention: conflicts with the household's rules. The household is never asked
 * to decide a single flow; its preset and rules decide. A flow we can't read (indeterminate) is never one of
 * them either: describing it correctly is the vendor's job, and we assume nothing about it
 * (CableLabs guidance, docs/cablelabs-guidance-vendor-terms-plan.md).
 */
export const needsAttention = (flow: Flow) => flow.evaluation.verdict === 'unsatisfiable'

/** Verdict counts for the chips. */
export function countVerdicts(device: Device): Partial<Record<Verdict, number>> {
  const out: Partial<Record<Verdict, number>> = {}
  for (const f of device.flows) out[f.evaluation.verdict] = (out[f.evaluation.verdict] ?? 0) + 1
  return out
}
