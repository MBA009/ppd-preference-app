import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateFlow } from '../../shared/engine'
import { finishOnboarding, normalizeHousehold, retirePreset, upsertRule } from '../../shared/household'
import { ruleTitle } from '../../shared/ruleTitle'
import { rulesOverlap, strictness } from '../../shared/scope'
import { followUps, promptFor, questionText, questionsLeft, rulesFromAnswers, stageOnePath, walk } from '../../shared/onboarding'
import { matchesDataflow } from '../../shared/scope'
import { CORE_TERMS, FIELDS } from '../../shared/taxonomy'
import type { Answers, Flow, Household, HouseholdPreset, Onboarding, OnboardingLeaf, OnboardingNode, Rule, Taxonomy } from '../../shared/types'

const mock = (file: string) => JSON.parse(readFileSync(new URL(`../../public/mock/${file}`, import.meta.url), 'utf8'))
const tree: Onboarding = mock('onboarding.json')
const presets: HouseholdPreset[] = mock('household-presets.json').presets
const cap = tree.source.total_questions_cap

/** Every way through the tree: the answers given, in order, and the leaf reached. */
function paths(node: OnboardingNode, answers: Answers = {}, asked: string[] = []): { asked: string[]; answers: Answers; leaf: OnboardingLeaf }[] {
  if (!('question' in node)) return [{ asked, answers, leaf: node }]
  const known = answers[node.question]
  if (known !== undefined) return paths(node.branches.find((b) => b.answers.includes(known))!.next, answers, asked)
  return node.branches.flatMap((b) => b.answers.map((a) => ({ b, a }))).flatMap(({ b, a }) => paths(b.next, { ...answers, [node.question]: a }, [...asked, node.question]))
}
const all = paths(tree.root)

test('every way through the questions ends in a preset the app has, every preset is reached, and nobody gets more than the cap', () => {
  const ids = new Set(presets.map((p) => p.id))
  assert.ok(all.every((p) => ids.has(p.leaf.preset)))
  assert.deepEqual(new Set(all.map((p) => p.leaf.preset)), ids)
  for (const p of all) {
    assert.equal(new Set(p.asked).size, p.asked.length, 'a question is never asked twice')
    assert.ok(p.asked.length + followUps(tree, p.leaf, p.answers).length <= cap)
    assert.ok(p.leaf.follow_ups.every((q) => tree.questions[q]?.situation), 'every follow-up is a situation')
  }
  assert.ok(!('children' in tree.questions), 'children are never asked about')
  assert.ok(presets.every((p) => p.shown_to_households === false))
})

test('walking with the answers given asks the next question, then lands on the leaf', () => {
  const path = all[0]
  const answers: Answers = {}
  assert.ok(questionsLeft(tree.root, answers) >= path.asked.length)
  for (const q of path.asked) {
    assert.deepEqual(walk(tree, answers), { question: q })
    answers[q] = path.answers[q]
  }
  assert.deepEqual(walk(tree, answers), { leaf: path.leaf })
  assert.deepEqual(stageOnePath(tree, answers), path.asked)
})

test('a prompt shows the example of a device the household owns', () => {
  const q = Object.values(tree.questions).find((x) => x.data_examples?.camera)!
  assert.ok(promptFor(q, ['camera']).includes(q.data_examples!.camera))
  assert.equal(promptFor(q, []), q.prompt)
})

test('a question is shown without its examples, then one example sentence of the data and the purpose', () => {
  for (const q of Object.values(tree.questions)) {
    for (const owned of [[], ['camera'], ['tv_media', 'light_plug']]) {
      const { text, example } = questionText(q, owned)
      assert.ok(!text.includes('for example') && !text.includes('('), text)
      assert.ok(example && !example.includes(', or ') && / (to|so) /.test(example), `one example with its purpose: ${example}`)
    }
  }
  const q = Object.values(tree.questions).find((x) => x.data_examples?.camera)!
  assert.ok(questionText(q, ['camera']).example!.includes(/\(for example, (?:when )?([^)]*)\)/.exec(q.data_examples!.camera)![1]))
})

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

/* ---------- answers into rules: the same result as notebook 07 ---------- */

const grid: Taxonomy[] = (() => {
  const out: Taxonomy[] = []
  const terms = FIELDS.map((f) => Object.keys(CORE_TERMS[f]))
  const rec = (i: number, acc: string[]) => {
    if (i === FIELDS.length) { out.push({ ...Object.fromEntries(FIELDS.map((f, j) => [f, acc[j]])), constraints: {} } as Taxonomy); return }
    for (const t of terms[i]) rec(i + 1, [...acc, t])
  }
  rec(0, [])
  return out
})()
const decision = (r: Rule) => (r.effect === 'dont_allow' ? 'deny' : r.condition ? `allow if ${r.condition}` : 'allow')
const decide = (rules: Rule[], t: Taxonomy) => rules.filter((r) => matchesDataflow(t, r.scope))

test('writing answers into a preset keeps exactly one rule per dataflow, gives every answered situation its answer, and leaves the rest', () => {
  assert.equal(grid.length, 6272)
  const choices = ['yes', 'no', 'depends']
  for (const [i, p] of all.filter((_, j) => j % Math.ceil(all.length / 12) === 0).entries()) {
    const answers: Answers = { ...p.answers }
    followUps(tree, p.leaf, answers).forEach((q, j) => { answers[q] = choices[(i + j) % 3] })
    const preset = presets.find((x) => x.id === p.leaf.preset)!
    const rules = rulesFromAnswers(preset, answers, tree.questions)
    for (const t of grid) {
      const hits = decide(rules, t)
      assert.equal(hits.length, 1, `exactly one rule decides ${JSON.stringify(t)}`)
      const answered = Object.entries(answers).find(([q, a]) => {
        const s = tree.questions[q]?.situation
        return s && a !== 'depends' && s.data_type === t.data_type && s.purpose === t.purpose && s.handling_context === t.handling_context
      })
      if (answered) assert.equal(decision(hits[0]), answered[1] === 'yes' ? 'allow' : 'deny')
      else assert.equal(decision(hits[0]), decision(decide(preset.rules, t)[0]), 'a flow nobody answered about keeps its preset decision')
    }
    assert.ok(rules.every((r) => r.title && r.id))
  }
})

test('finishing the questionnaire starts over; households on a retired preset, or saved before presets, go back to the questions', () => {
  const p = all[0]
  const answers: Answers = { ...p.answers }
  for (const q of followUps(tree, p.leaf, answers)) answers[q] = 'yes'
  const custom: Rule = { id: 'mine', title: 'mine', effect: 'dont_allow', scope: {}, enabled: true, origin: { kind: 'custom' } }
  const before: Household = { devices: [], saved: [], answers: null, preset_id: null, rules: [custom], profile: null }
  const h = finishOnboarding(before, tree, presets, { ...answers, not_asked_here: 'yes' })
  assert.equal(h.preset_id, p.leaf.preset)
  assert.ok(!h.rules.some((r) => r.id === 'mine'))
  assert.ok(!('not_asked_here' in (h.answers ?? {})), 'only answers the questionnaire asks are kept')
  assert.throws(() => finishOnboarding(before, tree, presets, {}))
  assert.deepEqual(retirePreset({ ...h, preset_id: 'k8-p0' }, presets), { ...h, preset_id: null, answers: null, rules: [] })
  assert.equal(retirePreset(h, presets), h)
  const legacy = { devices: [], saved: [], decisions: { x: {} }, answers: { q1: 'a' }, profile: null, rules: [custom] }
  const n = normalizeHousehold(legacy as never)
  assert.equal(n.preset_id, null)
  assert.ok(!('decisions' in n))
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

test('a rule is always named from what it does: the presets\' own names, and nothing anyone types', () => {
  for (const p of presets) for (const x of p.rules) assert.equal(ruleTitle(x), x.title)
  const typed: Rule = { id: 'mine', title: 'block cameras', effect: 'dont_allow', scope: { data_type: ['ppd:locationData'] }, enabled: true, origin: { kind: 'custom' } }
  const h = upsertRule({ devices: [], saved: [], answers: null, preset_id: 'x', rules: [], profile: null }, typed)
  assert.equal(h.rules[0].title, 'Never: location')
  assert.equal(normalizeHousehold({ ...h, rules: [typed] }).rules[0].title, 'Never: location', 'stored names are regenerated on load')
})

test('overlapping rules: found when every field shares a term, and the stricter one is known', () => {
  const never: Rule = { id: 'n', title: '', effect: 'dont_allow', scope: { data_type: ['ppd:contentData'], handling_context: ['ppd:vendorContext'] }, enabled: true, origin: { kind: 'custom' } }
  const allow: Rule = { ...never, id: 'a', effect: 'allow', scope: { ...never.scope, purpose: ['ppd:coreFunctionality'] } }
  assert.ok(rulesOverlap(allow, never))
  assert.ok(strictness(never) > strictness(allow))
  assert.ok(!rulesOverlap(allow, { ...never, scope: { data_type: ['ppd:locationData'] } }), 'different data never overlaps')
  assert.ok(!rulesOverlap(allow, { ...never, enabled: false }), 'a switched-off rule decides nothing')
  // In-home processing applies only to use and inference, so it does not meet a rule about sending data on.
  const inHome: Rule = { ...allow, condition: 'processing_boundary=ppd:inHomeOnly', scope: { data_type: ['ppd:contentData'] } }
  assert.ok(!rulesOverlap(inHome, { ...never, scope: { action: ['ppd:transfer'] } }))
})
