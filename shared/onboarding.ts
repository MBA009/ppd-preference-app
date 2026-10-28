import type { Answers, HouseholdPreset, Onboarding, OnboardingLeaf, OnboardingNode, OnboardingQuestion, Rule, RuleScope } from './types'
import { named } from './ruleTitle'
import { CORE_TERMS, FIELDS, type Field } from './taxonomy'

/**
 * The questionnaire (public/mock/onboarding.json, from ppd-household-presets notebook 07).
 *
 * Stage 1 walks a decision tree: show a question, follow the branch whose answers contain the chosen option, stop at
 * a leaf. A question can come back further down a path with a finer split; the earlier answer is reused, so it is
 * never asked twice. Stage 2 asks the leaf's follow-ups, the situations households like this one are split on, up to
 * the leaf's budget (the question cap minus stage 1). The answers to every situation are then written into the
 * leaf's preset rules (rulesFromAnswers).
 */

/** Where stage 1 stands: the next question to ask, or the leaf it ends in. */
export type Step = { question: string } | { leaf: OnboardingLeaf }

export function walk(tree: Onboarding, answers: Answers): Step {
  let node: OnboardingNode = tree.root
  while ('question' in node) {
    const answer = answers[node.question]
    const branch = answer === undefined ? undefined : node.branches.find((b) => b.answers.includes(answer))
    if (!branch) return { question: node.question }
    node = branch.next
  }
  return { leaf: node }
}

/** The questions stage 1 asks on the way to the leaf the answers lead to, in order, each once. */
export function stageOnePath(tree: Onboarding, answers: Answers): string[] {
  const asked: string[] = []
  let node: OnboardingNode = tree.root
  while ('question' in node) {
    const q = node.question
    if (!asked.includes(q)) asked.push(q)
    const branch = node.branches.find((b) => b.answers.includes(answers[q]))
    if (!branch) break
    node = branch.next
  }
  return asked
}

/** The most stage 1 questions still to ask before a leaf, counting a repeated question once. */
export function questionsLeft(node: OnboardingNode, answers: Answers, known: ReadonlySet<string> = new Set()): number {
  if (!('question' in node)) return 0
  const answer = answers[node.question]
  const branch = answer === undefined ? undefined : node.branches.find((b) => b.answers.includes(answer))
  if (branch) return questionsLeft(branch.next, answers, known)
  const asked = known.has(node.question)
  const next = asked ? known : new Set([...known, node.question])
  return (asked ? 0 : 1) + Math.max(...node.branches.map((b) => questionsLeft(b.next, answers, next)))
}

/** Stage 2 for a leaf: its follow-ups not already answered in stage 1, within its budget. */
export function followUps(tree: Onboarding, leaf: OnboardingLeaf, answers: Answers): string[] {
  const path = stageOnePath(tree, answers)
  return leaf.follow_ups.filter((q) => !path.includes(q)).slice(0, leaf.follow_up_budget)
}

/* ---------- examples the household can relate to ---------- */

/** The app's device categories and the device classes the questions carry examples for (notebook 01). */
export const CATEGORY_CLASS: Record<string, string> = {
  camera: 'camera', smart_lock: 'lock_entry', thermostat: 'thermostat_sensors', smart_tv: 'tv_media', light: 'light_plug',
  voice_assistant: 'voice_assistant', appliance: 'appliance',
}

/**
 * The question's prompt, with the data worded for a device the household owns when the question has an example for
 * it (an example the household cannot relate to biases its answer). The first owned class with an example wins.
 */
export function promptFor(q: OnboardingQuestion, ownedClasses: string[]): string {
  const examples = q.data_examples
  if (!examples?.default) return q.prompt
  const cls = ownedClasses.find((c) => examples[c])
  return cls ? q.prompt.replace(examples.default, examples[cls]) : q.prompt
}

/**
 * One example per kind of data, for a household that owns none of the devices a question has an example for. The
 * questions' own defaults list two or three examples in one, which is harder to read.
 */
const ONE_EXAMPLE: Record<string, string> = {
  'ppd:usageData': 'the times you switch your lights on and off',
  'ppd:sensorData': 'whether someone is home',
  'ppd:identifierData': 'your name and email address',
  'ppd:deviceAndNetworkData': 'your Wi-Fi network',
  'ppd:locationData': "your phone's location",
  'ppd:contentData': "a camera's video of your living room",
  'ppd:profileData': 'the daily routine it has learned',
}

/** The questions' purpose examples, one each, worded to follow the data example in one sentence. */
const PURPOSE_EXAMPLE: Record<string, string> = {
  'ppd:communicationsAndNotifications': 'so it can alert you on your phone',
  'ppd:diagnosticsAndMaintenance': 'to send error reports',
  'ppd:security': 'to spot a break-in',
  'ppd:analyticsAndImprovement': 'to study how people use the device',
  'ppd:personalization': 'to follow your daily routine',
  'ppd:coreFunctionality': 'so you can control it from your phone',
  'ppd:advertisingAndMarketing': 'to show you ads',
}

/** Who does what with the data, by where it goes, to open the example sentence. */
const EXAMPLE_VERB: Record<string, string> = {
  'ppd:vendorContext': 'the device sends',
  'ppd:thirdPartyContext': 'the maker passes on',
  'ppd:householdContext': 'the device uses',
}

const FOR_EXAMPLE = /\s*\(for example, ([^)]*)\)/g
const exampleIn = (s: string) => /\(for example, ([^)]*)\)/.exec(s)?.[1]

/**
 * The question as shown: the situation without its examples, then one example sentence joining the data example
 * (worded for a device the household owns when the question has one, as promptFor) and the purpose example.
 */
export function questionText(q: OnboardingQuestion, ownedClasses: string[]): { text: string; example: string | null } {
  const text = q.prompt.replace(FOR_EXAMPLE, '')
  const examples = q.data_examples ?? {}
  const cls = ownedClasses.find((c) => c !== 'default' && examples[c])
  const data = (cls && exampleIn(examples[cls])) || ONE_EXAMPLE[q.situation?.data_type ?? ''] || exampleIn(q.prompt)
  const purpose = PURPOSE_EXAMPLE[q.situation?.purpose ?? '']
  const verb = EXAMPLE_VERB[q.situation?.handling_context ?? ''] ?? 'the device shares'
  // "when you lock your door" reads as a time, not as data sent: "the times you lock your door".
  const what = data?.replace(/^when /, 'the times ')
  const example = what ? `${verb} ${what}${purpose ? `, ${purpose}` : ''}` : null
  return { text, example }
}

/* ---------- answers into rules ---------- */

const ALL: Record<Field, string[]> = Object.fromEntries(FIELDS.map((f) => [f, Object.keys(CORE_TERMS[f])])) as Record<Field, string[]>
type FullScope = Record<Field, string[]>

const full = (s: RuleScope): FullScope => Object.fromEntries(FIELDS.map((f) => [f, [...(s[f]?.length ? s[f]! : ALL[f])]])) as FullScope
const compact = (s: FullScope): RuleScope =>
  Object.fromEntries(FIELDS.filter((f) => s[f].length < ALL[f].length).map((f) => [f, s[f]])) as RuleScope

/** 0 deny, 1 allow, 2+ allow only under a condition: the same coding as the presets notebook. */
const decisionOf = (r: Rule) => (r.effect === 'dont_allow' ? 0 : r.condition ? 2 : 1)
const ANSWER_DECISION: Record<string, 0 | 1> = { yes: 1, no: 0 }

/**
 * The household's rules: the preset's rules with every yes or no the household gave to a situation written in.
 *
 * A preset's rules never overlap, so exactly one rule decides each flow. A situation (data type × purpose × handling
 * context) is a block of flows. Where the rule covering it says otherwise than the answer, that rule is split around
 * the situation, keeping everything else it decided (at most three pieces: the other data types; this data type with
 * the other purposes; this data type and purpose with the other handling contexts), and a rule with the answer is added
 * for the situation itself. "It depends" keeps the preset. Rules still never overlap, so no rule has to win over another.
 * Same result as notebook 07's write_answers, which checks it against every synthetic household.
 */
export function rulesFromAnswers(preset: HouseholdPreset, answers: Answers, questions: Record<string, OnboardingQuestion>): Rule[] {
  let rules: (Rule & { full: FullScope })[] = preset.rules.map((r) => ({ ...r, origin: { kind: 'preset', preset_id: preset.id }, full: full(r.scope) }))
  for (const [qid, answer] of Object.entries(answers)) {
    const situation = questions[qid]?.situation
    const d = ANSWER_DECISION[answer]
    if (!situation || d === undefined) continue
    const { data_type: t, purpose: p, handling_context: c } = situation
    const out: typeof rules = []
    for (const r of rules) {
      const s = r.full
      if (!(s.data_type.includes(t) && s.purpose.includes(p) && s.handling_context.includes(c)) || decisionOf(r) === d) {
        out.push(r)
        continue
      }
      const pieces: FullScope[] = [
        { ...s, data_type: s.data_type.filter((x) => x !== t) },
        { ...s, data_type: [t], purpose: s.purpose.filter((x) => x !== p) },
        { ...s, data_type: [t], purpose: [p], handling_context: s.handling_context.filter((x) => x !== c) },
      ]
      for (const piece of pieces) if (FIELDS.every((f) => piece[f].length)) out.push({ ...r, full: piece })
      out.push({
        id: '', title: '', effect: d === 1 ? 'allow' : 'dont_allow', condition: null, enabled: true, scope: {},
        origin: { kind: 'answer', question: qid }, full: { ...s, data_type: [t], purpose: [p], handling_context: [c] },
      })
    }
    rules = out
  }
  return rules.map(({ full: s, ...r }, i) => named({ ...r, id: `r${i}`, scope: compact(s) }))
}

/** Every answer the household gave to a situation question: what rulesFromAnswers writes in. */
export const situationAnswers = (tree: Onboarding, answers: Answers): Answers =>
  Object.fromEntries(Object.entries(answers).filter(([q, a]) => tree.questions[q]?.situation && a in ANSWER_DECISION))
