import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateFlow } from '../../shared/engine'
import { choosePreset, normalizeHousehold } from '../../shared/household'
import type { Answers, Flow, Household, HouseholdPreset, Onboarding, OnboardingNode, Rule } from '../../shared/types'
import { questionsLeft, walk } from '../../shared/onboarding'

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../../public/mock/${file}`, import.meta.url), 'utf8'))
const tree: Onboarding = mock('onboarding.json')
const presets: HouseholdPreset[] = mock('household-presets.json').presets

/** Every way through the tree: the answers given, in order, and the preset reached. */
function paths(node: OnboardingNode, answers: Answers = {}, asked: string[] = []): { asked: string[]; preset: string }[] {
  if (!('question' in node)) return [{ asked, preset: node.preset }]
  const known = answers[node.question]
  if (known !== undefined) return paths(node.branches.find((b) => b.answers.includes(known))!.next, answers, asked)
  return node.branches.flatMap((b) => b.answers.map((a) => ({ b, a }))).flatMap(({ b, a }) => paths(b.next, { ...answers, [node.question]: a }, [...asked, node.question]))
}

test('every way through the onboarding ends in a preset the app has, and every preset can be reached', () => {
  const all = paths(tree.root)
  const ids = new Set(presets.map((p) => p.id))
  assert.ok(all.every((p) => ids.has(p.preset)))
  assert.deepEqual(new Set(all.map((p) => p.preset)), ids)
  for (const p of all) assert.equal(new Set(p.asked).size, p.asked.length, 'a question is never asked twice')
})

test('walking with the answers given asks the next question, then lands on the preset', () => {
  const [path] = paths(tree.root)
  const answers: Answers = {}
  const left = questionsLeft(tree.root, answers)
  assert.ok(left >= path.asked.length && left <= 7)
  for (const q of path.asked) {
    const step = walk(tree, answers)
    assert.deepEqual(step, { question: q })
    const node = findOptions(q)
    answers[q] = node
  }
  assert.deepEqual(walk(tree, answers), { preset: path.preset })
  assert.equal(questionsLeft(tree.root, answers), 0)
})

/** The first option of the first branch of a question, as paths() picks it. */
function findOptions(q: string): string {
  const visit = (n: OnboardingNode): string | undefined => ('question' in n ? (n.question === q ? n.branches[0].answers[0] : n.branches.map((b) => visit(b.next)).find(Boolean)) : undefined)
  return visit(tree.root)!
}

test('exactly one rule of each preset covers each flow of the fixture devices', () => {
  const library: { devices: { id: string }[] } = mock('library.json')
  const flows: Flow[] = library.devices.flatMap((d) => (mock(`devices/${d.id}.json`) as { flows: Flow[] }).flows)
  for (const preset of presets) {
    for (const f of flows) {
      const e = evaluateFlow(f, preset.rules)
      if (e.verdict === 'indeterminate') continue
      assert.notEqual(e.reason, 'None of your rules allows this, so your devices are told no.', `${preset.id} covers ${f.id}`)
    }
  }
})

const sensorUse = { data_type: 'ppd:sensorData', purpose: 'ppd:coreFunctionality', action: 'ppd:use', source: 'ppd:participantObserved', handling_context: 'ppd:vendorContext', constraints: {} }
const asFlow = (taxonomy: object) => ({ id: 'f', evidence: 'source_linked', taxonomy }) as unknown as Flow
const r = (id: string, effect: Rule['effect'], condition: Rule['condition'] = null): Rule => ({ id, title: id, effect, condition, scope: { data_type: ['ppd:sensorData'] }, enabled: true, origin: { kind: 'custom' } })

test('verdicts: never beats "allowed only if", which beats allowed; nothing allowing a flow that leaves home denies it', () => {
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('a', 'allow'), r('n', 'dont_allow')]).verdict, 'unsatisfiable')
  const limited = evaluateFlow(asFlow(sensorUse), [r('a', 'allow'), r('l', 'allow', 'processing_boundary=ppd:inHomeOnly')])
  assert.equal(limited.verdict, 'conditionally_satisfiable')
  assert.equal(limited.rule_id, 'l')
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('a', 'allow')]).verdict, 'compatible')
  assert.equal(evaluateFlow(asFlow(sensorUse), []).verdict, 'unsatisfiable')
  assert.equal(evaluateFlow(asFlow({ ...sensorUse, handling_context: 'ppd:householdContext' }), []).verdict, 'compatible')
  // A processing boundary means nothing for a transfer, so that rule does not cover it.
  assert.equal(evaluateFlow(asFlow({ ...sensorUse, action: 'ppd:transfer' }), [r('l', 'allow', 'processing_boundary=ppd:inHomeOnly')]).verdict, 'unsatisfiable')
})

test('households saved before presets go back to onboarding, keeping custom allow and never rules', () => {
  const legacy = {
    devices: [], saved: [], decisions: { x: {} }, group_decisions: {}, answers: { q1: 'a' }, profile: null,
    rules: [
      { id: 'q', title: 'q', effect: 'allow', scope: {}, enabled: true, origin: { kind: 'questionnaire', question_id: 'q1', answer: 'a' } },
      { id: 'c', title: 'c', effect: 'ask', scope: {}, enabled: true, origin: { kind: 'custom' } },
      { id: 'n', title: 'n', effect: 'dont_allow', scope: {}, enabled: true, origin: { kind: 'custom' } },
    ],
  }
  const h = normalizeHousehold(legacy as never)
  assert.equal(h.answers, null)
  assert.equal(h.preset_id, null)
  assert.deepEqual(h.rules.map((x) => x.id), ['n'])
  assert.ok(!('decisions' in h))
  const chosen = choosePreset(h, presets[0])
  assert.deepEqual(chosen.answers, {})
  assert.deepEqual(normalizeHousehold(chosen as Household & Record<string, unknown>), chosen)
})
