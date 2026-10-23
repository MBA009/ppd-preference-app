import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Device, Flow, Household } from '../../shared/types'
import { countVerdicts, needsAttention } from '../../src/lib/verdicts'

const flow = (id: string, verdict: Flow['evaluation']['verdict']) =>
  ({ id, core_group: { id: `g-${id}` }, evaluation: { verdict, rule_id: null, reason: '' } }) as unknown as Flow
const household = { decisions: {}, group_decisions: {} } as unknown as Household

test('a flow we cannot read is never something the household is asked about', () => {
  // CableLabs guidance (docs/cablelabs-guidance-vendor-terms-plan.md): an invalid or unresolved declaration is the
  // vendor's problem; we assume nothing about it and never prompt the household.
  assert.equal(needsAttention(flow('a', 'indeterminate'), household), false)
  assert.equal(needsAttention(flow('b', 'unsatisfiable'), household), true)
  assert.equal(needsAttention(flow('c', 'decision_required'), household), true)
})

test('unreadable flows are still counted, as information', () => {
  const device = { flows: [flow('a', 'indeterminate'), flow('b', 'compatible')] } as unknown as Device
  assert.deepEqual(countVerdicts(device, household), { indeterminate: 1, compatible: 1 })
})
