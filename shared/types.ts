import type { Constraints, Field } from './taxonomy'

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
  | 'indeterminate' //              "Can't tell": no source for the flow, or a term the comparison cannot resolve

/**
 * Where a device stands with the household's rules. For devices known to the gateway these follow the
 * protocol's association states (draft-dsmullen-ppd-protocol-04 section 7.14); research fixtures use
 * 'rules_confirmed' and 'waiting_for_renewal'.
 */
export type DeclarationState =
  | 'advisory' //                   non-PPD device, researched library entry
  | 'registered_no_declaration'
  | 'not_associated' //             registered, rules not received and acknowledged yet
  | 'rules_confirmed' //            associated: the device acknowledged receiving the current rules (receipt only)
  | 'waiting_for_renewal' //        research fixtures only: a rule change is waiting to be picked up
  | 'stale' //                      stale_association: the device did not renew in time
  | 'needs_reassociation'
  | 'broken'

export type DeviceIcon = 'thermostat' | 'lock' | 'tv' | 'camera' | 'bulb'

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
  source?: string[]
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

/** The taxonomy fields of one flow: five core ppd: terms and the Constraints Object (protocol-04 section 7.8). */
export interface Taxonomy {
  data_type: string
  purpose: string
  action: string
  source: string
  handling_context: string
  constraints: Constraints
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
  /** 'real' and 'simulated' devices talk to the PPD gateway; 'research' entries come from our fixtures. */
  kind?: 'real' | 'simulated' | 'research'
  declaration: Declaration | null
  declaration_id_example: string
  flow_count: number
}

export interface Device extends DeviceSummary {
  flows: Flow[]
  /** Present for devices known to the PPD gateway (real hardware or simulated participants). */
  live?: LiveState
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

/* ---------- PPD wire objects (draft-dsmullen-ppd-protocol-04 section 7) ---------- */
export interface TaxonomyContext { release?: string; prefixes?: Record<string, string> }

export interface PolicyRule extends Record<Field, string> {
  rule_id: string
  effect: 'allow' | 'deny'
  constraints?: Constraints
}

/** A household (or device override) policy as the repository stores it. */
export interface Policy {
  policy_id: string
  taxonomy?: TaxonomyContext
  scope: string
  rules: PolicyRule[]
  updated_at?: string
}

export type AssociationStatus = 'not_associated' | 'associated' | 'needs_reassociation' | 'stale_association' | 'broken' | 'policy_conflict'
export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

/** What the gateway knows about a participating device (the CableLabs dashboard's device view). */
export interface LiveState {
  kind: 'real' | 'simulated'
  association: {
    status: AssociationStatus
    label: string
    tone: Tone
    explanation: string
    next_step: string
    attention: string | null
    fresh_until: string | null
    renewed_at: string | null
    freshness_interval: string | null
  }
  /** Lifecycle steps in order, with when each one last happened. */
  lifecycle: { step: 'registered' | 'declared' | 'policy_retrieved' | 'acknowledged' | 'associated'; label: string; done: boolean; at: string | null }[]
  registration: { manufacturer: string; model: string; firmware_version: string; registered_at: string | null }
  declaration_id: string | null
  /** The policy instance the gateway last delivered to this device. */
  effective_policy: { policy_id: string; policy_hash: string; base_policy_id: string; applied_policy_id: string | null; retrieved_at: string | null; source: string } | null
  /** The instance the device acknowledged. A receipt only: it never means the device complies. */
  receipt: { policy_id: string; policy_hash: string; acknowledged_at: string | null; current: boolean } | null
  /** Whether the device has picked up the household policy the app last published. */
  publication: 'current' | 'waiting' | 'not_published'
  identity: { auth_method: string; label: string; tone: Tone; certificate_bound: boolean }
  network: { observed: boolean; label: string; mac_address: string | null; ip_address: string | null; hostname: string | null }
  runtime: { conflict_active: boolean; behavior_mode: string | null; conflicting_purposes: string[] }
  badges: { label: string; tone: Tone }[]
}

/* ---------- operator views ---------- */
export interface Overview {
  gateway: { reachable: boolean; security: string; mutual_tls_required: boolean; tls_enabled: boolean; freshness_interval: string | null; error: string | null }
  /** The gateway's counts. `known`, `associated`, `unmanaged` and `need_attention` are the CableLabs dashboard's four cards. */
  counts: {
    known: number; registered: number; declared: number; policy_retrieved: number; acknowledged: number; associated: number
    needs_reassociation: number; stale: number; broken: number; policy_conflict: number; overrides: number; authenticated: number; compatibility_mode: number
    network_observed: number; unmanaged: number; need_attention: number
  }
  household_policy: { policy_id: string | null; updated_at: string | null; published_by_app: boolean }
  updated_at: string
}

export interface HealthCheck { id: string; group: 'gateway' | 'repository' | 'app'; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface SystemStatus { checks: HealthCheck[]; updated_at: string }

export interface Me { email: string; role: 'operator' | 'viewer'; simulator: boolean }

/**
 * A device the home router sees on the network that never registered with PPD ("unmanaged" on the
 * CableLabs dashboard; architecture-11 section 7.6). It cannot receive the household rules.
 */
export interface UnmanagedDevice {
  id: string
  hostname: string | null
  ip_address: string | null
  mac_address: string | null
  /** The gateway's guess from the network name and probes. */
  likely_type: string | null
  likely_vendor: string | null
  last_seen: string | null
  /** A research library entry that looks like this device. */
  research_match: { id: string; short_name: string } | null
  simulated: boolean
}

/* ---------- demo simulator ---------- */
export type SimMode = 'ppd' | 'network'
export interface SimDevice {
  id: string
  name: string
  short_name: string
  icon: DeviceIcon
  /** 'ppd' devices join through PPD; 'network' devices only appear on the network (unmanaged). */
  mode: SimMode
  /** What the presenter asked for. */
  wanted: 'off' | 'connected' | 'disconnected' | 'on_network'
  /** What the simulated device is doing right now. */
  state: 'off' | 'joining' | 'associated' | 'paused' | 'on_network' | 'error'
  hostname: string
  ip_address: string
  mac_address: string
  last_event: string | null
  last_event_at: string | null
  last_error: string | null
}

/** One atomic rule the compiler wants to publish, and why. */
export interface CompiledRule extends PolicyRule {
  reason: string
  /** Which device flows produced it. */
  flows: { device_id: string; flow_id: string; title: string }[]
  change: 'added' | 'changed' | 'unchanged'
}

export interface PublishPreview {
  base_policy_id: string | null
  rules: CompiledRule[]
  removed: PolicyRule[]
  /** Flows whose household rule says "Ask me first" and that have no decision yet. Publishing waits for them. */
  blocked: { device_id: string; flow_id: string; title: string; reason: string }[]
  warnings: string[]
  devices: number
}

export interface PublishResult { policy_id: string; rules: number; published_at: string; preview: PublishPreview }

export interface Preset { name: string; title: string; summary: string; policy_id: string; current: boolean }

export interface Command { id: string; device_id: string; action: CommandAction; value: string | null; status: 'queued' | 'delivered' | 'completed' | 'skipped' | 'failed' | 'expired'; detail: string | null; created_at: string; expires_at: string }
export type CommandAction = 'advance_step' | 'set_lifecycle_mode' | 'set_behavior_mode' | 'reassociate'

export interface TelemetrySample { sample_id: string; purpose: string; temperature_c: number | null; humidity_pct: number | null; reported_policy_id: string | null; behavior_mode: string | null; received_at: string }
export interface Telemetry { samples: TelemetrySample[]; by_purpose: { purpose: string; label: string; count: number; last_at: string | null }[] }

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

  /* Gateway-backed views (empty or unavailable in mock mode). */
  getMe(): Promise<Me>
  getOverview(): Promise<Overview>
  getSystemStatus(): Promise<SystemStatus>
  /** The household policy the gateway currently serves, or null if none is reachable. */
  getPublishedPolicy(): Promise<Policy | null>
  previewPublish(): Promise<PublishPreview>
  publish(): Promise<PublishResult>
  listPresets(): Promise<Preset[]>
  applyPreset(name: string): Promise<Policy>
  disassociate(deviceId: string): Promise<void>
  /** Deletes a device that has left the home from the gateway and the household. Refused while associated or on the network. */
  forgetDevice(deviceId: string): Promise<Household>
  listCommands(deviceId: string): Promise<Command[]>
  sendCommand(deviceId: string, action: CommandAction, value?: string): Promise<Command>
  getTelemetry(deviceId: string): Promise<Telemetry>
  /** Devices on the network that do not speak PPD. */
  listUnmanaged(): Promise<UnmanagedDevice[]>

  /* Demo simulator (only when app-api runs with SIMULATOR=1). */
  listSimDevices(): Promise<SimDevice[]>
  simConnect(id: string): Promise<SimDevice>
  simDisconnect(id: string): Promise<SimDevice>
  simNetwork(id: string, present: boolean): Promise<SimDevice>
  simReset(): Promise<SimDevice[]>
}
