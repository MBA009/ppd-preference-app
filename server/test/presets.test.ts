import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { evaluateFlow } from '../../shared/engine'
import { answerQuestion, deleteRule, finishOnboarding, normalizeHousehold, retirePreset, upsertRule } from '../../shared/household'
import { ruleTitle } from '../../shared/ruleTitle'
import { CORE_FLOWS, decidingRule, decisionKey, gapScopes, ruleCovers, rulesOverlap, undecidedFlows } from '../../shared/scope'
import { conditionConstraints, declaresCondition, jurisdictionCondition, jurisdictionOf } from '../../shared/conditions'
import { followUps, promptFor, questionText, questionsLeft, refineQueue, rulesFromAnswers, stageOnePath, walk } from '../../shared/onboarding'
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
      assert.notEqual(e.verdict, 'decision_required', `${preset.id} covers ${f.id}`)
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
  assert.deepEqual(retirePreset({ ...h, preset_id: 'k8-p0' }, presets), { ...h, preset_id: null, answers: null, answered_at: {}, rules: [] })
  assert.equal(retirePreset(h, presets), h)
  const legacy = { devices: [], saved: [], decisions: { x: {} }, answers: { q1: 'a' }, profile: null, rules: [custom] }
  const n = normalizeHousehold(legacy as never)
  assert.equal(n.preset_id, null)
  assert.ok(!('decisions' in n))
})

/* ---------- refining: the open-ended queue (Nov 2 meeting) ---------- */

/** What the rules decide for a flow: the latest-changed enabled rule that covers it, or null. */
const effective = (rules: Rule[], t: Taxonomy) => {
  const rule = decidingRule(rules, t)
  return rule ? decision(rule) : null
}
const inSituation = (qid: string, t: Taxonomy) => {
  const s = tree.questions[qid].situation!
  return s.data_type === t.data_type && s.purpose === t.purpose && s.handling_context === t.handling_context
}

test('every leaf ranks every situation for refining, most unsure first, starting the queue past the cap', () => {
  const situations = Object.keys(tree.questions).filter((q) => tree.questions[q].situation)
  assert.ok(typeof tree.stop_unsure === 'number' && tree.stop_unsure > 0 && tree.stop_unsure < 1)
  for (const p of all) {
    const queue = p.leaf.queue!
    assert.deepEqual(new Set(queue.map((e) => e.question)), new Set(situations))
    assert.ok(queue.every((e, i) => i === 0 || queue[i - 1].unsure >= e.unsure))
    assert.ok(queue.every((e) => e.accept >= 0 && e.accept <= 1))
  }
})

test('refining: never answered most unsure first, then a check-up oldest first; an answer changes only its situation and keeps edits', () => {
  const p = all[0]
  const answers: Answers = { ...p.answers }
  for (const q of followUps(tree, p.leaf, answers)) answers[q] = 'yes'
  const blank: Household = { devices: [], saved: [], answers: null, preset_id: null, rules: [], profile: null }
  const mine: Rule = { id: 'mine', title: '', effect: 'dont_allow', scope: { data_type: ['ppd:contentData'], handling_context: ['ppd:publicAudience'] }, enabled: true, origin: { kind: 'custom' } }
  const h0 = upsertRule(finishOnboarding(blank, tree, presets, answers, new Date('2026-11-01T00:00:00Z')), mine)

  const q0 = refineQueue(tree, h0)
  assert.equal(q0.undecided, 0)
  assert.equal(new Set(q0.items.map((i) => i.question)).size, q0.items.length, 'each situation once')
  const kinds = q0.items.map((i) => i.reason)
  assert.deepEqual(kinds, [...kinds].sort((a, b) => ['undecided', 'split', 'likely', 'checkup'].indexOf(a) - ['undecided', 'split', 'likely', 'checkup'].indexOf(b)))
  assert.deepEqual(new Set(q0.items.filter((i) => i.reason === 'checkup').map((i) => i.question)), new Set(Object.keys(h0.answers!).filter((q) => tree.questions[q].situation)))
  const split = q0.items.filter((i) => i.reason === 'split')
  assert.equal(split.length, q0.split)
  assert.ok(split.every((i) => i.entry!.unsure >= tree.stop_unsure!))

  // One answer: its situation takes it, every other flow keeps its decision, the person's own rule stays.
  const first = q0.items[0].question
  const flip = (t: Taxonomy) => (effective(h0.rules, t) === 'deny' ? 'yes' : 'no')
  const target = grid.find((t) => inSituation(first, t))!
  const ans = flip(target)
  const h1 = answerQuestion(h0, tree, first, ans, new Date('2026-11-02T00:00:00Z'))
  for (const t of grid) {
    if (inSituation(first, t)) assert.equal(effective(h1.rules, t), ans === 'yes' ? 'allow' : 'deny')
    else assert.equal(effective(h1.rules, t), effective(h0.rules, t), 'a flow outside the situation keeps its decision')
  }
  assert.ok(h1.rules.some((r) => r.id === 'mine'), 'rules the person added stay')
  assert.equal(new Set(h1.rules.map((r) => r.id)).size, h1.rules.length, 'rule ids stay unique')
  const q1 = refineQueue(tree, h1)
  assert.equal(q1.items.at(-1)!.question, first, 'the newest answer is checked last')
  assert.equal(q1.split, q0.split - 1)

  // Answering again: the latest answer wins, with one rule for it.
  const h2 = answerQuestion(h1, tree, first, ans === 'yes' ? 'no' : 'yes')
  assert.equal(h2.rules.filter((r) => r.origin.kind === 'answer' && r.origin.question === first).length, 1)
  assert.equal(effective(h2.rules, target), ans === 'yes' ? 'deny' : 'allow')

  // Deleting that rule leaves the situation with no rule: asked first.
  const h3 = deleteRule(h2, `answer.${first}`)
  assert.deepEqual(refineQueue(tree, h3).items[0], { question: first, reason: 'undecided', entry: q0.items[0].entry })
  assert.equal(refineQueue(tree, h3).goodPicture, false)

  // Once every split situation is answered, the rules are a good picture; the queue goes on with the rest.
  let h4 = h2
  for (const i of refineQueue(tree, h4).items.filter((i) => i.reason === 'split')) h4 = answerQuestion(h4, tree, i.question, 'depends')
  const q4 = refineQueue(tree, h4)
  assert.ok(q4.goodPicture)
  assert.ok(q4.items.length > 0 && q4.items[0].reason === 'likely')

  assert.throws(() => answerQuestion(h0, tree, 'nope', 'yes'))
  assert.throws(() => answerQuestion(h0, tree, first, 'maybe'))
  assert.throws(() => answerQuestion(blank, tree, first, 'yes'))
})

const sensorUse = { data_type: 'ppd:sensorData', purpose: 'ppd:coreFunctionality', action: 'ppd:use', source: 'ppd:participantObserved', handling_context: 'ppd:vendorContext', constraints: {} }
const asFlow = (taxonomy: object) => ({ id: 'f', evidence: 'source_linked', taxonomy }) as unknown as Flow
const r = (id: string, effect: Rule['effect'], condition: Rule['condition'] = null): Rule => ({ id, title: id, effect, condition, scope: { data_type: ['ppd:sensorData'] }, enabled: true, origin: { kind: 'custom' } })

test('verdicts: where rules disagree the latest change wins, whatever it says; a flow no rule covers needs a decision, wherever it goes', () => {
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('a', 'allow'), r('n', 'dont_allow')]).verdict, 'unsatisfiable')
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('n', 'dont_allow'), r('a', 'allow')]).verdict, 'compatible', 'a later Allow beats an earlier Never')
  const limited = evaluateFlow(asFlow(sensorUse), [r('n', 'dont_allow'), r('a', 'allow'), r('l', 'allow', 'processing_boundary=ppd:inHomeOnly')])
  assert.equal(limited.verdict, 'conditionally_satisfiable')
  assert.equal(limited.rule_id, 'l')
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('n', 'dont_allow'), { ...r('a', 'allow'), enabled: false }]).verdict, 'unsatisfiable', 'a switched-off rule decides nothing')
  // Saving a rule makes it the latest: an edited rule moves to the end, and so wins again.
  const h = upsertRule(upsertRule(upsertRule({ devices: [], saved: [], answers: null, preset_id: 'x', rules: [], profile: null }, r('n', 'dont_allow')), r('a', 'allow')), r('n', 'dont_allow'))
  assert.deepEqual(h.rules.map((x) => x.id), ['a', 'n'])
  assert.equal(evaluateFlow(asFlow(sensorUse), h.rules).verdict, 'unsatisfiable')
  assert.equal(evaluateFlow(asFlow(sensorUse), [r('a', 'allow')]).verdict, 'compatible')
  // No default outside the household's rules: staying home or leaving it, an uncovered flow is undecided.
  assert.equal(evaluateFlow(asFlow(sensorUse), []).verdict, 'decision_required')
  assert.equal(evaluateFlow(asFlow({ ...sensorUse, handling_context: 'ppd:householdContext' }), []).verdict, 'decision_required')
  // A limit the device declares is not "With limits": that verdict always names a household rule.
  const onDevice = { ...sensorUse, handling_context: 'ppd:householdContext', constraints: { processing_boundary: 'ppd:onDeviceOnly' } }
  const own = evaluateFlow(asFlow(onDevice), [])
  assert.equal(own.verdict, 'decision_required')
  assert.match(own.reason, /The device says it stays on the device\./)
  assert.equal(evaluateFlow(asFlow(onDevice), [r('a', 'allow')]).verdict, 'compatible')
  assert.equal(evaluateFlow(asFlow({ ...sensorUse, constraints: { retention: 'ppd:ephemeral' } }), []).verdict, 'decision_required')
  // A processing boundary means nothing for a transfer, so that rule does not cover it.
  assert.equal(evaluateFlow(asFlow({ ...sensorUse, action: 'ppd:transfer' }), [r('l', 'allow', 'processing_boundary=ppd:inHomeOnly')]).verdict, 'decision_required')
})

test('flows with no rule: none under a preset; deleting or switching off a rule leaves exactly what it alone covered', () => {
  assert.equal(CORE_FLOWS.length, 6272)
  for (const p of presets) {
    assert.equal(undecidedFlows(p.rules).length, 0)
    const [first, ...rest] = p.rules
    const covered = CORE_FLOWS.filter((t) => ruleCovers(first, t)).length
    assert.equal(undecidedFlows(rest).length, covered, 'preset rules never overlap')
    assert.equal(undecidedFlows([{ ...first, enabled: false }, ...rest]).length, covered)
  }
})

test('settling flows with no rule covers exactly them, never the rules that already decide part of a situation', () => {
  const p = presets[0]
  const [first, ...rest] = p.rules
  const situation = (t: Taxonomy) => ({ data_type: [t.data_type], purpose: [t.purpose], handling_context: [t.handling_context] })
  // One flow of a situation already has its own rule (a decision on a device's page); the rest of it has none.
  const one = CORE_FLOWS.find((t) => ruleCovers(first, t))!
  const own: Rule = { id: 'own', title: '', effect: 'allow', scope: { ...situation(one), action: [one.action], source: [one.source] }, enabled: true, origin: { kind: 'custom' } }
  let rules = [...rest, own]
  const key = (t: Taxonomy) => FIELDS.map((f) => t[f]).join()
  const groups = new Map<string, Taxonomy[]>()
  for (const t of undecidedFlows(rules)) groups.set(key({ ...t, action: '', source: '' } as Taxonomy), [...(groups.get(key({ ...t, action: '', source: '' } as Taxonomy)) ?? []), t])
  for (const flows of groups.values()) {
    const scopes = gapScopes(situation(flows[0]), flows)
    const added = scopes.map((scope, i): Rule => ({ id: `s${i}`, title: '', effect: 'dont_allow', scope, enabled: true, origin: { kind: 'custom' } }))
    for (const t of CORE_FLOWS) assert.equal(added.some((r) => ruleCovers(r, t)), flows.some((f) => key(f) === key(t)))
    rules = [...rules, ...added]
  }
  assert.equal(undecidedFlows(rules).length, 0)
})

test('conditions: deleted right after use, in the home or on the device, or only in some places (taxonomy-05 section 6.7)', () => {
  const stored = jurisdictionCondition('storage', ['us', 'us-ca'])
  assert.deepEqual(conditionConstraints(stored), { jurisdiction: { scope: 'storage', countrycode: ['us'], subdivisioncode: ['us-ca'] } })
  assert.deepEqual(conditionConstraints('retention=ppd:ephemeral'), { retention: 'ppd:ephemeral' })
  assert.equal(ruleTitle({ effect: 'allow', condition: 'retention=ppd:ephemeral', scope: { data_type: ['ppd:contentData'] } }), 'Allow only if deleted right after use: video, photos and sound')
  assert.equal(ruleTitle({ effect: 'allow', condition: jurisdictionCondition('transfer', ['us-ca']), scope: { data_type: ['ppd:contentData'] } }),
    'Allow only if sent only to companies in California: video, photos and sound')
  assert.ok(!jurisdictionOf('jurisdiction.storage=USA') && !jurisdictionOf('jurisdiction.anywhere=us'), 'only lowercase ISO codes and the five scopes')

  // A scope that names an action covers only that action; storage covers every action.
  const sent = { ...r('j', 'allow'), condition: jurisdictionCondition('transfer', ['us']) }
  assert.ok(ruleCovers(sent, { ...sensorUse, action: 'ppd:transfer' }))
  assert.ok(!ruleCovers(sent, sensorUse))
  assert.ok(ruleCovers({ ...sent, condition: stored }, sensorUse))

  // With limits either way; the reason says whether the device already declares a place the rule allows.
  const keptIn = (countrycode: string[]) => asFlow({ ...sensorUse, constraints: { jurisdiction: { scope: 'storage', countrycode } } })
  const rule = { ...r('j', 'allow'), condition: jurisdictionCondition('storage', ['us']) }
  assert.equal(evaluateFlow(keptIn(['us']), [rule]).verdict, 'conditionally_satisfiable')
  assert.match(evaluateFlow(keptIn(['us']), [rule]).reason, /stored only in the United States\. The device says it is\./)
  assert.match(evaluateFlow(keptIn(['cn']), [rule]).reason, /Your devices are told so\./)
  assert.ok(declaresCondition(stored, { jurisdiction: { scope: 'storage', subdivisioncode: ['us-ca'] } }))
  assert.ok(!declaresCondition(jurisdictionCondition('storage', ['us-ca']), { jurisdiction: { scope: 'storage', countrycode: ['us'] } }), 'a whole country is not inside one state')
})

test('a rule is always named from what it does: the presets\' own names, and nothing anyone types', () => {
  for (const p of presets) for (const x of p.rules) assert.equal(ruleTitle(x), x.title)
  const typed: Rule = { id: 'mine', title: 'block cameras', effect: 'dont_allow', scope: { data_type: ['ppd:locationData'] }, enabled: true, origin: { kind: 'custom' } }
  const h = upsertRule({ devices: [], saved: [], answers: null, preset_id: 'x', rules: [], profile: null }, typed)
  assert.equal(h.rules[0].title, 'Never: location')
  assert.equal(normalizeHousehold({ ...h, rules: [typed] }).rules[0].title, 'Never: location', 'stored names are regenerated on load')
})

test('overlapping rules: found when every field shares a term, and whether they decide differently', () => {
  const never: Rule = { id: 'n', title: '', effect: 'dont_allow', scope: { data_type: ['ppd:contentData'], handling_context: ['ppd:vendorContext'] }, enabled: true, origin: { kind: 'custom' } }
  const allow: Rule = { ...never, id: 'a', effect: 'allow', scope: { ...never.scope, purpose: ['ppd:coreFunctionality'] } }
  assert.ok(rulesOverlap(allow, never))
  assert.notEqual(decisionKey(never), decisionKey(allow))
  assert.equal(decisionKey({ ...allow, id: 'b' }), decisionKey(allow))
  assert.ok(!rulesOverlap(allow, { ...never, scope: { data_type: ['ppd:locationData'] } }), 'different data never overlaps')
  assert.ok(!rulesOverlap(allow, { ...never, enabled: false }), 'a switched-off rule decides nothing')
  // In-home processing applies only to use and inference, so it does not meet a rule about sending data on.
  const inHome: Rule = { ...allow, condition: 'processing_boundary=ppd:inHomeOnly', scope: { data_type: ['ppd:contentData'] } }
  assert.ok(!rulesOverlap(inHome, { ...never, scope: { action: ['ppd:transfer'] } }))
})
