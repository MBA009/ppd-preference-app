/**
 * The contract between the app and app-api (server/), shared by both.
 *
 * The app talks to app-api through httpClient.ts; mockClient.ts answers the same calls offline from
 * public/mock/. The JSON shapes below are what tools/build_mock.py writes.
 */

/** One verdict per flow: the comparison of a flow with the household rules, and nothing else. */
export type Verdict =
  | 'compatible' //                 shown as "Matches your rules"
  | 'conditionally_satisfiable' //  "With limits"
  | 'decision_required' //          "Needs your decision"
  | 'unsatisfiable' //              "Conflicts with your rules"
  | 'indeterminate' //              "Can't tell" (our mapping for missing sources; not a draft term)

export type DeclarationState =
  | 'advisory' //                   non-PPD device, researched library entry
  | 'registered_no_declaration'
  | 'rules_confirmed' //            the device acknowledged receiving the rules (receipt only)
  | 'waiting_for_renewal' //        app-defined: a rule change is waiting to be picked up
  | 'stale'
  | 'needs_reassociation'

export type DeviceIcon = 'thermostat' | 'lock' | 'tv' | 'camera'

/** What a rule says to do with a flow it matches. Stricter wins: dont_allow beats ask, ask beats allow. */
export type RuleEffect = 'allow' | 'ask' | 'dont_allow'

/**
 * Which flows a rule is about. Every field is optional (left out = any) and lists IRIs from the PPD taxonomy,
 * normally the core terms (ppd:contentData, ppd:advertisingAndMarketing, ppd:vendorContext, ...).
 * A flow matches when, for each field given, it has one of the listed values. `constraints` entries
 * (for example 'retention=ppd:indefinite') must all be present on the flow.
 */
export interface RuleScope {
  data_type?: string[]
  purpose?: string[]
  handling_context?: string[]
  action?: string[]
  constraints?: string[]
}

export interface Rule {
  id: string
  /** The sentence the person sees. */
  title: string
  effect: RuleEffect
  scope: RuleScope
  enabled: boolean
  /** Where the rule came from: an answer to a question, or the person adding it. */
  origin: { kind: 'questionnaire'; question_id: string; row_id?: string; answer: string } | { kind: 'custom' }
}

/** What the person wants to hear about. Saved with the policy; nothing sends these yet. */
export interface Profile {
  summary_frequency: 'daily' | 'monthly' | 'yearly' | 'never'
  warn_on_conflict: boolean
}

/* ---------- the questionnaire (decision tree), served as JSON ---------- */
export interface Source { short: string; citation: string; url: string; pdf?: string }

export type Condition =
  | { all_rows: { question: string; equals: string } }
  | { answer: { question: string; equals?: string; in?: string[] } }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] }

export interface TemplateRule { id: string; effect: RuleEffect; scope: RuleScope; title: string }
export interface Option { id: string; label: string; prefill?: { question: string; row: string; value: string }[]; rules: TemplateRule[] }
export interface ScaleItem { id: string; label: string; effect: RuleEffect }
export interface MatrixRow { id: string; label: string; example: string; scope: RuleScope; titles: Record<string, string> }
export interface ProfileField { id: string; type: 'single' | 'toggle'; label: string; default: string | boolean; options?: { id: string; label: string }[] }

interface QuestionBase { id: string; short: string; prompt: string; help: string; why: string; sources: string[]; show_if?: Condition }
export type Question =
  | (QuestionBase & { type: 'single'; default: string | null; options: Option[] })
  | (QuestionBase & { type: 'matrix'; scale: ScaleItem[]; default: string; rows: MatrixRow[] })
  | (QuestionBase & { type: 'profile'; fields: ProfileField[] })

export interface Questionnaire {
  version: string
  title: string
  description: string
  disclaimer: string
  precedence: RuleEffect[]
  sources: Record<string, Source>
  questions: Question[]
}

/** single: option id. matrix: row id to scale id. profile: field id to value. */
export type AnswerValue = string | Record<string, string | boolean>
export type Answers = Record<string, AnswerValue>

/** The taxonomy fields of one flow, as IRIs (data_type, purpose, action, source, handling_context, constraints). */
export interface Taxonomy {
  data_type: string
  purpose: string
  action: string
  source: string
  handling_context: string
  constraints: string[]
}

export interface Flow {
  id: string
  /** Short plain-language title shown in lists. */
  title: string
  /** The original wording from the research workbook. */
  workbook_text: string
  summary: string
  summary_parts: { who: string; purpose: string }
  phase: 'setup' | 'runtime' | 'setup+runtime'
  taxonomy: Taxonomy
  /** Plain-language values for the taxonomy fields (What / Why / What happens / Comes from / Handled by / Kept). */
  display: {
    what: string
    why: string
    what_happens: string
    comes_from: string
    handled_by: string
    kept: string
    limit: string | null
  }
  /** The coarse (core) taxonomy terms of this flow. Household rules are written in these. */
  core: { data_type: string; purpose: string; action: string; source: string; handling_context: string }
  /** Flows in the same core rule group can share one saved preference. */
  core_group: { id: string; label: string }
  /** Read-only. Whether a user can limit the flow. Never changes a verdict. */
  control: {
    type: 'user_setting' | 'setup_step' | 'user_initiated' | 'external_request' | 'none_documented' | 'unknown'
    type_label: string
    necessity: 'optional' | 'required_for_feature' | 'unknown'
    note: string | null
  }
  evidence: 'source_linked' | 'needs_source'
  /** The comparison of this flow with the household's current rules. Computed by the backend on every read. */
  evaluation: { verdict: Verdict; rule_id: string | null; reason: string }
}

export interface Declaration {
  state: DeclarationState
  declaration_id: string
  received_at: string
  renew_by: string
  statements: number
}

export interface DeviceSummary {
  id: string
  name: string
  short_name: string
  category: string
  category_label: string
  icon: DeviceIcon
  matter: boolean
  /** 'declared' = the device published a PPD declaration. 'advisory' = researched library entry. */
  source: 'declared' | 'advisory'
  declaration: Declaration | null
  declaration_id_example: string
  flow_count: number
}

export interface Device extends DeviceSummary {
  flows: Flow[]
}

export type Preference = 'allow' | 'allow_with_limits' | 'dont_allow'

export interface Decision {
  flow_id: string
  device_id: string
  preference: Preference
  /** Only with 'allow_with_limits'. */
  keep?: 'briefly' | 'until_deleted'
  region?: string
  /** Also applies to other flows in the same core rule group. */
  remember_similar: boolean
  core_group_id: string
  decided_at: string
}

export interface HomeEntry {
  device_id: string
  added_at: string
  /** False until the person has seen the "joined your home" screen. */
  joined_seen?: boolean
}

export interface Household {
  devices: HomeEntry[]
  saved: string[]
  decisions: Record<string, Decision>
  /** Preferences remembered for every flow in a core rule group. */
  group_decisions: Record<string, Decision>
  /** Answers to the questionnaire. null until the person has answered it (first launch). */
  answers: Answers | null
  /** The household policy: generated from the answers, then edited by the person. */
  rules: Rule[]
  profile: Profile | null
}

export type ResolveResult =
  | { ok: true; device_id: string }
  | { ok: false; reason: 'matter_code' | 'unknown_code' | 'not_a_code' }

export interface PpdApi {
  getQuestionnaire(): Promise<Questionnaire>
  /** The household's rules. */
  listRules(): Promise<Rule[]>
  /** Stores the answers and the policy generated from them (custom rules the person added are kept by the caller). */
  savePolicy(p: { answers: Answers; rules: Rule[]; profile: Profile }): Promise<Household>
  upsertRule(rule: Rule): Promise<Household>
  deleteRule(id: string): Promise<Household>
  listLibrary(): Promise<DeviceSummary[]>
  getDevice(id: string): Promise<Device>
  /** Turns the text from a scanned (or typed) privacy code into a device. */
  resolveCode(payload: string): Promise<ResolveResult>

  getHousehold(): Promise<Household>
  addDevice(id: string, opts?: { joined?: boolean }): Promise<Household>
  removeDevice(id: string): Promise<Household>
  saveForLater(id: string): Promise<Household>
  markJoinedSeen(id: string): Promise<Household>
  saveDecision(d: Omit<Decision, 'decided_at'>): Promise<Household>
  /** Test helper: 'seed' restores the fixture household, 'empty' removes everything. */
  resetDemo(mode: 'seed' | 'empty'): Promise<Household>
}
