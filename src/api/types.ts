/**
 * The contract between the app and "the backend".
 *
 * Today every method is answered from the static JSON in public/mock/ (see mockClient.ts).
 * When a real backend exists, implement `PpdApi` against it and change one line in ./index.ts.
 * The JSON shapes below are what tools/build_mock.py writes.
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

export interface Rule {
  id: string
  title: string
  effect: 'allow' | 'dont_allow'
  /** 'all' or the device ids the rule is about (e.g. camera and microphone rules). */
  applies_to: 'all' | string[]
}

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
  verdict_counts?: Partial<Record<Verdict, number>>
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
}

export type ResolveResult =
  | { ok: true; device_id: string }
  | { ok: false; reason: 'matter_code' | 'unknown_code' | 'not_a_code' }

export interface PpdApi {
  listRules(): Promise<Rule[]>
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
