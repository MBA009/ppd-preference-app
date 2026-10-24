import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Device, Flow } from '../../shared/types'
import { countVerdicts, needsAttention } from '../../shared/engine'

const flow = (id: string, verdict: Flow['evaluation']['verdict']) =>
  ({ id, core_group: { id: `g-${id}` }, evaluation: { verdict, rule_id: null, reason: '' } }) as unknown as Flow

test('only conflicts need attention; the household is never asked about a single flow', () => {
  // CableLabs guidance (docs/cablelabs-guidance-vendor-terms-plan.md): an invalid or unresolved declaration is the
  // vendor's problem; we assume nothing about it and never prompt the household. Presets and rules decide the rest.
  assert.equal(needsAttention(flow('a', 'indeterminate')), false)
  assert.equal(needsAttention(flow('b', 'unsatisfiable')), true)
  assert.equal(needsAttention(flow('c', 'conditionally_satisfiable')), false)
})

test('unreadable flows are still counted, as information', () => {
  const device = { flows: [flow('a', 'indeterminate'), flow('b', 'compatible')] } as unknown as Device
  assert.deepEqual(countVerdicts(device), { indeterminate: 1, compatible: 1 })
})
