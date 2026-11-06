import type { Answers, Household, HouseholdPreset, Onboarding, OnboardingLeaf, OnboardingNode, OnboardingQuestion, QueueEntry, Rule, RuleScope } from './types'
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

/** The kind of data, in the words of a question. */
const DATA_WORDS: Record<string, string> = {
  'ppd:identifierData': 'your name and contact information',
  'ppd:profileData': 'a profile of your habits and preferences',
  'ppd:sensorData': 'sensor readings',
  'ppd:contentData': 'video or audio',
  'ppd:locationData': 'your location',
  'ppd:deviceAndNetworkData': 'information about the device and your network',
  'ppd:usageData': 'information about how you use your devices',
}

/** Why, in the words of a question. */
const PURPOSE_WORDS: Record<string, string> = {
  'ppd:coreFunctionality': 'so the device works',
  'ppd:personalization': 'to personalize what it does for you',
  'ppd:communicationsAndNotifications': 'to send you alerts and messages',
  'ppd:security': 'to keep your home and the device secure',
  'ppd:diagnosticsAndMaintenance': 'to fix problems and update the device',
  'ppd:analyticsAndImprovement': 'to improve products',
  'ppd:advertisingAndMarketing': 'for advertising and marketing',
}

/** The sentence, by where the data goes (week 10: "Consider a device that asks you to allow it to…"). */
const QUESTION: Record<string, (data: string, purpose: string) => string> = {
  'ppd:vendorContext': (data, purpose) => `Consider a device that asks you to allow it to share ${data} with the manufacturer, ${purpose}. Would you allow this?`,
  'ppd:thirdPartyContext': (data, purpose) => `Consider a device whose manufacturer asks you to allow it to share ${data} with other companies, ${purpose}. Would you allow this?`,
  'ppd:householdContext': (data, purpose) => `Consider a device that asks you to allow it to use ${data} ${purpose}, without the data leaving your home. Would you allow this?`,
}

const DEVICE: Record<string, string> = {
  thermostat_sensors: 'your smart thermostat', camera: 'your security camera', lock_entry: 'your smart lock', tv_media: 'your smart TV',
}

/** The example sentence, by where the data goes. */
const EXAMPLE: Record<string, (device: string, data: string, why: string) => string> = {
  'ppd:vendorContext': (device, data, why) => `${device} shares ${data} with the manufacturer, ${why}`,
  'ppd:thirdPartyContext': (device, data, why) => `the manufacturer of ${device} shares ${data} with another company, ${why}`,
  'ppd:householdContext': (device, data, why) => `${device} uses ${data} ${why}, without it leaving your home`,
}

type Scenario = [deviceClass: string, data: string, why: string]

/**
 * One believable situation per data type and purpose: an example joined from a separate data example and purpose
 * example says what no device does (week 10). The first is the default; a later one is shown to a household that owns
 * that device, because an example the household cannot relate to biases its answer (week 9).
 */
const SCENARIOS: Record<string, Record<string, Scenario[]>> = {
  'ppd:usageData': {
    'ppd:coreFunctionality': [['thermostat_sensors', 'the temperature you set', 'so it can keep your home at that temperature'], ['lock_entry', 'the times you lock and unlock the door', 'so you can see whether the door is locked']],
    'ppd:personalization': [['thermostat_sensors', 'the temperatures you choose during the day', 'to learn a heating schedule that suits you'], ['tv_media', 'the shows you watch', 'to recommend shows you might like']],
    'ppd:communicationsAndNotifications': [['thermostat_sensors', 'the temperature you set', 'to send you alerts if the temperature is outside a given range'], ['lock_entry', 'the times you lock and unlock the door', 'to alert you if the door is left unlocked']],
    'ppd:security': [['lock_entry', 'the times you lock and unlock the door', 'to flag the lock being used at an unusual time']],
    'ppd:diagnosticsAndMaintenance': [['thermostat_sensors', 'the settings you change', 'to find the cause of a fault'], ['tv_media', 'the apps you open', 'to find out why an app keeps crashing']],
    'ppd:analyticsAndImprovement': [['tv_media', 'the features you use', 'to decide which features to improve'], ['thermostat_sensors', 'the features you use', 'to decide which features to improve']],
    'ppd:advertisingAndMarketing': [['tv_media', 'the shows you watch', 'to show you ads for similar shows']],
  },
  'ppd:sensorData': {
    'ppd:coreFunctionality': [['thermostat_sensors', 'the temperature in your home', 'so it can turn the heating on and off'], ['camera', 'the motion it detects', 'so it knows when to start recording']],
    'ppd:personalization': [['thermostat_sensors', 'a reading of whether someone is home', 'to lower the heating when nobody is home']],
    'ppd:communicationsAndNotifications': [['thermostat_sensors', 'the temperature in your home', 'to alert you if your home gets too cold'], ['camera', 'the motion it detects', 'to alert you when someone is at your door']],
    'ppd:security': [['camera', 'the motion it detects', 'to spot a possible break-in'], ['lock_entry', 'the times the door is opened', 'to spot a possible break-in']],
    'ppd:diagnosticsAndMaintenance': [['thermostat_sensors', 'its temperature readings', 'to check that its sensor is working']],
    'ppd:analyticsAndImprovement': [['thermostat_sensors', 'its temperature readings', 'to learn how well the product heats homes']],
    'ppd:advertisingAndMarketing': [['thermostat_sensors', 'the temperature you keep your home at', 'to show you ads for heating products']],
  },
  'ppd:identifierData': {
    'ppd:coreFunctionality': [['lock_entry', 'your name and email address', 'so you can sign in and manage the lock']],
    'ppd:personalization': [['tv_media', 'your account name', 'to show your own watchlist']],
    'ppd:communicationsAndNotifications': [['camera', 'your email address', 'to email you when it detects motion']],
    'ppd:security': [['lock_entry', 'your account details', 'to check that it is really you unlocking the door']],
    'ppd:diagnosticsAndMaintenance': [['thermostat_sensors', 'your email address', 'to tell you about a fault and how to fix it']],
    'ppd:analyticsAndImprovement': [['tv_media', 'your account ID', 'to see how long customers keep using the product']],
    'ppd:advertisingAndMarketing': [['tv_media', 'your email address', 'to send you offers by email']],
  },
  'ppd:profileData': {
    'ppd:coreFunctionality': [['thermostat_sensors', 'the heating schedule it has learned', 'so it can run your heating on that schedule']],
    'ppd:personalization': [['thermostat_sensors', 'the heating schedule it has learned', 'to suggest changes that suit your routine'], ['tv_media', 'the kinds of shows you like', 'to recommend shows you might like']],
    'ppd:communicationsAndNotifications': [['thermostat_sensors', 'the routine it has learned', 'to remind you if the heating is on when you are usually out']],
    'ppd:security': [['lock_entry', 'the times you usually come and go', 'to flag the door opening at an unusual time']],
    'ppd:diagnosticsAndMaintenance': [['thermostat_sensors', 'the heating schedule it has learned', 'to work out why the heating is not following it']],
    'ppd:analyticsAndImprovement': [['tv_media', 'the kinds of shows you like', 'to plan new features']],
    'ppd:advertisingAndMarketing': [['tv_media', 'the kinds of shows you like', 'to show you ads you are more likely to watch']],
  },
  'ppd:contentData': {
    'ppd:coreFunctionality': [['camera', 'its video of your front door', 'so you can watch it live']],
    'ppd:personalization': [['camera', 'its video of your front door', 'to recognize people you know']],
    'ppd:communicationsAndNotifications': [['camera', 'a video clip of your front door', 'to send you an alert showing who is there']],
    'ppd:security': [['camera', 'its video of your home', 'to spot a possible break-in']],
    'ppd:diagnosticsAndMaintenance': [['camera', 'a short video clip', 'to work out why its picture is blurry']],
    'ppd:analyticsAndImprovement': [['camera', 'short video clips', 'to make it better at detecting people']],
    'ppd:advertisingAndMarketing': [['camera', 'its video of your home', 'to show you ads for products it sees']],
  },
  'ppd:locationData': {
    'ppd:coreFunctionality': [['thermostat_sensors', "your home's location", 'so it can adjust for the local weather']],
    'ppd:personalization': [['thermostat_sensors', "your home's location", 'to suggest a heating schedule for your climate']],
    'ppd:communicationsAndNotifications': [['thermostat_sensors', "your home's location", 'to warn you about a coming cold snap']],
    'ppd:security': [['camera', "your home's location", 'to help emergency services find your home']],
    'ppd:diagnosticsAndMaintenance': [['tv_media', 'your general location', 'to check for a service outage in your area']],
    'ppd:analyticsAndImprovement': [['tv_media', 'your general location', 'to see which regions use the product most']],
    'ppd:advertisingAndMarketing': [['tv_media', 'your general location', 'to show you ads for local shops']],
  },
  'ppd:deviceAndNetworkData': {
    'ppd:coreFunctionality': [['camera', 'the name of your Wi-Fi network', 'so it can stay connected']],
    'ppd:personalization': [['tv_media', 'its screen and sound settings', 'to adjust shows to your setup']],
    'ppd:communicationsAndNotifications': [['lock_entry', 'its battery level', 'to alert you when the battery is low']],
    'ppd:security': [['camera', 'its software version', 'to warn you about a security problem']],
    'ppd:diagnosticsAndMaintenance': [['thermostat_sensors', 'its error logs and Wi-Fi signal strength', 'to find and fix a fault']],
    'ppd:analyticsAndImprovement': [['tv_media', 'its model and software version', 'to see which versions are most used']],
    'ppd:advertisingAndMarketing': [['tv_media', 'its model and the other devices on your network', 'to show you ads for related products']],
  },
}

/** Where the usual scenario cannot happen with the data staying in the home. */
const HOME_SCENARIOS: Record<string, Scenario> = {
  'ppd:identifierData ppd:communicationsAndNotifications': ['lock_entry', 'your name', 'to show on its screen who unlocked the door'],
  'ppd:locationData ppd:security': ['lock_entry', "your home's location", 'to lock the door automatically at sunset'],
}

const FOR_EXAMPLE = /\s*\(for example, ([^)]*)\)/g

/** The question as shown: one sentence from the situation, then one example line, from a device the household owns if there is one. */
export function questionText(q: OnboardingQuestion, ownedClasses: string[]): { text: string; example: string | null } {
  const { data_type: t = '', purpose: p = '', handling_context: c = '' } = q.situation ?? {}
  const text = c in QUESTION && t in DATA_WORDS && p in PURPOSE_WORDS ? QUESTION[c](DATA_WORDS[t], PURPOSE_WORDS[p]) : q.prompt.replace(FOR_EXAMPLE, '')
  const scenarios = SCENARIOS[t]?.[p] ?? []
  const scenario = (c === 'ppd:householdContext' && HOME_SCENARIOS[`${t} ${p}`]) || scenarios.find(([cls]) => ownedClasses.includes(cls)) || scenarios[0]
  if (!scenario || !(c in EXAMPLE)) return { text, example: null }
  const [cls, data, why] = scenario
  return { text, example: EXAMPLE[c](DEVICE[cls], data, why) }
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
 * for the situation itself. "Not sure" keeps the preset. Rules still never overlap, so no rule has to win over another.
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

/* ---------- refining: an open-ended queue (Nov 2 meeting) ---------- */

/**
 * One answer written into the household's current rules ("Help me refine my settings"). Every rule that decides the
 * situation otherwise is cut around it, as in rulesFromAnswers, and one rule with the answer decides it. An earlier
 * answer to the same question is replaced (the latest answer wins); everything else stays: other answers, the person's
 * own rules and edits. "Not sure" changes nothing.
 */
export function writeAnswer(rules: Rule[], qid: string, answer: string, questions: Record<string, OnboardingQuestion>): Rule[] {
  const situation = questions[qid]?.situation
  const d = ANSWER_DECISION[answer]
  if (!situation || d === undefined) return rules
  const { data_type: t, purpose: p, handling_context: c } = situation
  const out: Rule[] = []
  for (const r of rules) {
    if (r.origin.kind === 'answer' && r.origin.question === qid) continue
    const s = full(r.scope)
    if (!(s.data_type.includes(t) && s.purpose.includes(p) && s.handling_context.includes(c)) || decisionOf(r) === d) {
      out.push(r)
      continue
    }
    const pieces: FullScope[] = [
      { ...s, data_type: s.data_type.filter((x) => x !== t) },
      { ...s, data_type: [t], purpose: s.purpose.filter((x) => x !== p) },
      { ...s, data_type: [t], purpose: [p], handling_context: s.handling_context.filter((x) => x !== c) },
    ]
    pieces.forEach((piece, i) => {
      if (FIELDS.every((f) => piece[f].length)) out.push(named({ ...r, id: `${r.id}.${i}`, scope: compact(piece) }))
    })
  }
  const scope = compact({ ...ALL, data_type: [t], purpose: [p], handling_context: [c] })
  return [...out, named({ id: `answer.${qid}`, title: '', effect: d === 1 ? 'allow' : 'dont_allow', condition: null, enabled: true, scope, origin: { kind: 'answer', question: qid } })]
}

/** The situation questions some of whose flows no enabled rule decides: the household deleted the rule that did. */
export function undecidedSituations(tree: Onboarding, rules: Rule[]): Set<string> {
  const scopes = rules.filter((r) => r.enabled).map((r) => full(r.scope))
  const out = new Set<string>()
  for (const [qid, q] of Object.entries(tree.questions)) {
    if (!q.situation) continue
    const { data_type: t, purpose: p, handling_context: c } = q.situation
    const here = scopes.filter((s) => s.data_type.includes(t) && s.purpose.includes(p) && s.handling_context.includes(c))
    if (!ALL.action.every((a) => ALL.source.every((src) => here.some((s) => s.action.includes(a) && s.source.includes(src))))) out.add(qid)
  }
  return out
}

/**
 * Why a situation is next: no rule decides it any more (asked first), households like this one are split on it, they
 * mostly agree but it was never asked, or it is a check-up of an earlier answer (oldest first).
 */
export type RefineReason = 'undecided' | 'split' | 'likely' | 'checkup'
export interface RefineItem { question: string; reason: RefineReason; entry: QueueEntry | null }
export interface RefineQueue {
  items: RefineItem[]
  /** Situations still to ask that households like this one are split on (at least `stop_unsure`). */
  split: number
  undecided: number
  /** Nothing undecided and nothing split left: the household's rules say what it wants. */
  goodPicture: boolean
}

/**
 * The refine queue, never empty while there are situation questions: the household's leaf ranks every situation by how
 * unsure households like it are. Situations with no rule come first, then those never answered (most unsure first),
 * then earlier answers, oldest first, as a check-up.
 */
export function refineQueue(tree: Onboarding, h: Pick<Household, 'answers' | 'answered_at' | 'rules'>): RefineQueue {
  const answers = h.answers ?? {}
  const step = walk(tree, answers)
  const none = { items: [], split: 0, undecided: 0, goodPicture: false }
  if (!('leaf' in step)) return none
  const queue = step.leaf.queue ?? []
  const entry = new Map(queue.map((e) => [e.question, e]))
  const situations = Object.keys(tree.questions).filter((q) => tree.questions[q].situation)
  const order = [...queue.map((e) => e.question).filter((q) => tree.questions[q]?.situation), ...situations.filter((q) => !entry.has(q))]
  const gaps = undecidedSituations(tree, h.rules)
  const stop = tree.stop_unsure ?? 0
  const isSplit = (q: string) => (entry.get(q)?.unsure ?? 1) >= stop
  const at = h.answered_at ?? {}
  const undecided = order.filter((q) => gaps.has(q))
  const unasked = order.filter((q) => !gaps.has(q) && !(q in answers))
  const answered = order.filter((q) => !gaps.has(q) && q in answers).sort((a, b) => (at[a] ?? '').localeCompare(at[b] ?? ''))
  const item = (reason: RefineReason) => (q: string): RefineItem => ({ question: q, reason, entry: entry.get(q) ?? null })
  const split = unasked.filter(isSplit).length
  return {
    items: [...undecided.map(item('undecided')), ...unasked.map((q) => item(isSplit(q) ? 'split' : 'likely')(q)), ...answered.map(item('checkup'))],
    split, undecided: undecided.length, goodPicture: undecided.length === 0 && split === 0,
  }
}
