import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { evaluateDevice } from '../../shared/engine'
import { FIELDS, PROCESSING_BOUNDARY, RETENTION, termLabel, type Constraints } from '../../shared/taxonomy'
import type { AssociationStatus, DeclarationState, Device, DeviceIcon, DeviceSummary, Flow, LiveState, Rule, Tone, UnmanagedDevice } from '../../shared/types'
import type { Fixtures } from './fixtures'
import type { GatewayClient, GatewayDevice, GatewaySummary } from './gateway'

/**
 * Devices known to the PPD gateway, in the app's Device shape. A device's flows are its declared
 * statements (core ppd: terms); its LiveState is the gateway's view of registration, policy delivery,
 * receipt, association and identity (what the CableLabs dashboard shows).
 */

interface StatementPresentation { title?: string; what?: string }
/** How the demo simulator plays this device (server/src/simulator). */
export interface SimulatorEntry { mode: 'ppd' | 'network'; mac: string; ip: string; hostname: string }
export interface RegistryEntry {
  device_id: string
  kind: 'real' | 'simulated'
  fixture?: string
  simulator?: SimulatorEntry
  match_manufacturer?: string
  name?: string
  short_name?: string
  category?: string
  category_label?: string
  icon?: DeviceIcon
  matter?: boolean
  statements?: Record<string, StatementPresentation>
}

export function loadRegistry(path: string): RegistryEntry[] {
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { devices: RegistryEntry[] }).devices
  } catch {
    return []
  }
}

const STATE: Record<string, DeclarationState> = {
  associated: 'rules_confirmed',
  policy_conflict: 'rules_confirmed',
  stale_association: 'stale',
  needs_reassociation: 'needs_reassociation',
  broken: 'broken',
}

const ASSOCIATION_LABEL: Record<AssociationStatus, [string, Tone]> = {
  associated: ['Associated', 'good'],
  policy_conflict: ['Associated · runtime conflict', 'warn'],
  stale_association: ['Association stale', 'warn'],
  needs_reassociation: ['Needs reassociation', 'warn'],
  broken: ['Association broken', 'bad'],
  not_associated: ['Not associated', 'neutral'],
}

const HANDLER_SHORT: Record<string, string> = { 'ppd:vendorContext': 'the maker', 'ppd:thirdPartyContext': 'other companies', 'ppd:publicAudience': 'the public' }
const VERB: Record<string, string> = { 'ppd:transfer': 'Goes to', 'ppd:collection': 'Collected by', 'ppd:use': 'Used by', 'ppd:inference': 'Worked out by' }

const tone = (t: string | undefined): Tone => (t === 'good' || t === 'warn' || t === 'bad' ? t : 'neutral')
const titleCase = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function tupleKey(f: Record<(typeof FIELDS)[number], string>): string {
  return FIELDS.map((k) => f[k]).join('|')
}
const groupId = (key: string) => 'core-' + createHash('sha256').update(key).digest('hex').slice(0, 8)

/** `devices` registered with PPD; `unmanaged` seen on the network only (network_observed && !known_to_gateway). */
export interface GatewaySnapshot { devices: GatewayDevice[]; unmanaged: GatewayDevice[]; summary: GatewaySummary }

export class LiveDirectory {
  private cache: ({ at: number } & GatewaySnapshot) | null = null
  private inflight: Promise<GatewaySnapshot> | null = null

  constructor(private readonly gateway: GatewayClient, private readonly fixtures: Fixtures, readonly registry: RegistryEntry[], private readonly ttlMs = 1500) {}

  /** The gateway's devices and summary, cached briefly so one screen does not ask the gateway once per device. */
  async snapshot(): Promise<GatewaySnapshot> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache
    this.inflight ??= Promise.all([this.gateway.devices(), this.gateway.summary()]).then(
      ([devices, summary]) => {
        this.cache = { at: Date.now(), devices: devices.filter((d) => d.registered), unmanaged: devices.filter((d) => d.network_observed && !d.known_to_gateway), summary }
        this.inflight = null
        return this.cache
      },
      (e) => {
        this.inflight = null
        throw e
      },
    )
    return this.inflight
  }

  async gatewayDevices(): Promise<GatewayDevice[]> {
    return (await this.snapshot()).devices
  }

  invalidate(): void {
    this.cache = null
  }

  /** Fixture ids that a simulated device stands in for. */
  simulatedFixtureIds(): Set<string> {
    return new Set(this.registry.filter((r) => r.kind === 'simulated' && r.fixture).map((r) => r.fixture!))
  }

  /** Fixture ids represented by a device registered at the gateway right now (so the library shows it once). */
  connectedFixtureIds(devices: GatewayDevice[]): Set<string> {
    return new Set(devices.map((d) => this.entryFor(d)?.fixture).filter((f): f is string => !!f))
  }

  /** Devices on the network that never registered with PPD, with a research entry that looks like them. */
  unmanaged(devices: GatewayDevice[]): UnmanagedDevice[] {
    return devices.map((d) => {
      const sim = this.registry.find((r) => r.simulator && r.simulator.mac.toLowerCase() === (d.mac_address ?? '').toLowerCase())
      const fixture = (sim?.fixture && this.fixtures.devices.get(sim.fixture)) || this.researchMatch(d)
      return {
        id: d.device_id,
        hostname: d.hostname || null,
        ip_address: d.ip_address || null,
        mac_address: d.mac_address || null,
        likely_type: d.likely_device_type || null,
        likely_vendor: d.likely_device_vendor || null,
        last_seen: d.last_network_observed_at || null,
        research_match: fixture ? { id: fixture.id, short_name: fixture.short_name } : null,
        simulated: !!sim,
      }
    })
  }

  /** A research entry whose vendor appears in the device's network name or the gateway's vendor guess. */
  private researchMatch(d: GatewayDevice) {
    const text = `${d.hostname ?? ''} ${d.likely_device_vendor ?? ''}`.toLowerCase()
    if (!text.trim()) return undefined
    return [...this.fixtures.devices.values()].find((f) => {
      const vendor = f.name.split(' ')[0].toLowerCase()
      return vendor.length > 1 && new RegExp(`(^|[^a-z])${vendor}([^a-z]|$)`).test(text)
    })
  }

  entryFor(d: Pick<GatewayDevice, 'device_id' | 'manufacturer'>): RegistryEntry | undefined {
    return this.registry.find((r) => r.device_id === d.device_id) ?? this.registry.find((r) => r.match_manufacturer && r.match_manufacturer === d.manufacturer)
  }

  summary(d: GatewayDevice): DeviceSummary {
    const entry = this.entryFor(d)
    const fixture = entry?.fixture ? this.fixtures.devices.get(entry.fixture) : undefined
    const status = (d.association_status || 'not_associated') as AssociationStatus
    const state: DeclarationState = STATE[status] ?? (d.declared ? 'not_associated' : 'registered_no_declaration')
    const fallbackName = [d.manufacturer, d.model].filter(Boolean).join(' ') || d.device_id
    return {
      id: d.device_id,
      name: entry?.name ?? fixture?.name ?? fallbackName,
      short_name: entry?.short_name ?? fixture?.short_name ?? (d.model || d.device_id),
      category: entry?.category ?? fixture?.category ?? 'device',
      category_label: entry?.category_label ?? fixture?.category_label ?? 'Connected device',
      icon: entry?.icon ?? fixture?.icon ?? 'bulb',
      matter: entry?.matter ?? fixture?.matter ?? false,
      source: 'declared',
      kind: entry?.kind ?? 'real',
      declaration: d.declared
        ? {
            state,
            declaration_id: d.declaration_id ?? '',
            received_at: d.declared_at ?? d.registered_at ?? new Date().toISOString(),
            renew_by: d.association_fresh_until ?? '',
            statements: d.declaration_statements?.length ?? 0,
          }
        : null,
      declaration_id_example: d.declaration_id ?? d.device_id,
      flow_count: d.declaration_statements?.length ?? 0,
    }
  }

  /** The full device: flows from the declaration (evaluated against `rules`) and the gateway's live view. */
  device(d: GatewayDevice, rules: Rule[], publishedPolicyId: string | null): Device {
    const entry = this.entryFor(d)
    const fixture = entry?.fixture ? this.fixtures.devices.get(entry.fixture) : undefined
    const flows: Flow[] = (d.declaration_statements ?? []).map((s) => {
      const taxonomy = { data_type: s.data_type, purpose: s.purpose, action: s.action, source: s.source, handling_context: s.handling_context, constraints: (s.constraints ?? {}) as Constraints }
      const id = `${d.device_id}.${s.statement_id}`
      const researched = fixture?.flows.find((f) => f.id === `${fixture.id}.${s.statement_id}`)
      // A simulated participant declares a researched fixture's flows: keep their wording and control notes.
      if (researched) return { ...researched, id, taxonomy }
      return statementFlow(id, s.statement_id, taxonomy, entry?.statements?.[s.statement_id])
    })
    return evaluateDevice({ ...this.summary(d), flows, live: liveState(d, entry?.kind ?? 'real', publishedPolicyId) }, rules)
  }
}

function statementFlow(id: string, statementId: string, t: Flow['taxonomy'], p: StatementPresentation | undefined): Flow {
  const home = t.handling_context === 'ppd:householdContext'
  const purpose = termLabel('purpose', t.purpose)
  const who = home ? 'Stays in your home' : `${VERB[t.action] ?? 'Handled by'} ${HANDLER_SHORT[t.handling_context] ?? 'another party'}`
  const key = tupleKey(t)
  return {
    id,
    title: p?.title ?? titleCase(statementId),
    workbook_text: statementId,
    summary: `${who} · ${purpose.toLowerCase()}`,
    summary_parts: { who, purpose: purpose.toLowerCase() },
    phase: 'runtime',
    taxonomy: t,
    display: {
      what: p?.what ?? termLabel('data_type', t.data_type),
      why: purpose,
      what_happens: termLabel('action', t.action),
      comes_from: termLabel('source', t.source),
      handled_by: termLabel('handling_context', t.handling_context),
      kept: t.constraints.retention ? RETENTION[t.constraints.retention] ?? 'Not stated' : 'Not stated',
      limit: t.constraints.processing_boundary ? PROCESSING_BOUNDARY[t.constraints.processing_boundary] ?? null : null,
    },
    core: { data_type: t.data_type, purpose: t.purpose, action: t.action, source: t.source, handling_context: t.handling_context },
    core_group: { id: groupId(key), label: `${termLabel('data_type', t.data_type)} · ${purpose.toLowerCase()} · ${termLabel('handling_context', t.handling_context).toLowerCase()}` },
    control: { type: 'unknown', type_label: 'Not stated by the device', necessity: 'unknown', note: null },
    evidence: 'source_linked',
    evaluation: { verdict: 'indeterminate', rule_id: null, reason: '' },
  }
}

function liveState(d: GatewayDevice, kind: 'real' | 'simulated', publishedPolicyId: string | null): LiveState {
  const status = (d.association_status || 'not_associated') as AssociationStatus
  const [label, statusTone] = ASSOCIATION_LABEL[status] ?? ASSOCIATION_LABEL.not_associated
  const receiptCurrent = !!d.ack_policy_id && d.ack_policy_id === d.effective_policy_id && d.ack_policy_hash === d.policy_hash
  const publication: LiveState['publication'] = !publishedPolicyId
    ? 'not_published'
    : d.base_policy_id === publishedPolicyId && receiptCurrent && status === 'associated'
      ? 'current'
      : 'waiting'
  const at = (v: string | undefined) => v || null
  return {
    kind,
    association: {
      status,
      label,
      tone: statusTone,
      explanation: d.association_explanation ?? '',
      next_step: d.next_step_summary ?? '',
      attention: d.attention_reason || null,
      fresh_until: at(d.association_fresh_until),
      renewed_at: at(d.last_association_renewed_at),
      freshness_interval: at(d.association_freshness_interval),
    },
    lifecycle: [
      { step: 'registered', label: 'Registered', done: d.registered, at: at(d.registered_at) },
      { step: 'declared', label: 'Declared what it does', done: d.declared, at: at(d.declared_at) },
      { step: 'policy_retrieved', label: 'Received your rules', done: d.policy_retrieved, at: at(d.last_policy_retrieved) },
      { step: 'acknowledged', label: 'Confirmed receipt', done: d.acknowledged, at: at(d.last_acknowledged_at) },
      { step: 'associated', label: 'Associated', done: status === 'associated' || status === 'policy_conflict', at: at(d.last_association_renewed_at) },
    ],
    registration: { manufacturer: d.manufacturer ?? '', model: d.model ?? '', firmware_version: d.firmware_version ?? '', registered_at: at(d.registered_at) },
    declaration_id: d.declaration_id || null,
    effective_policy: d.effective_policy_id
      ? { policy_id: d.effective_policy_id, policy_hash: d.policy_hash ?? '', base_policy_id: d.base_policy_id ?? '', applied_policy_id: d.applied_policy_id || null, retrieved_at: at(d.last_policy_retrieved), source: d.policy_source_label ?? '' }
      : null,
    receipt: d.ack_policy_id ? { policy_id: d.ack_policy_id, policy_hash: d.ack_policy_hash ?? '', acknowledged_at: at(d.last_acknowledged_at), current: receiptCurrent } : null,
    publication,
    identity: { auth_method: d.auth_method ?? 'unknown', label: d.auth_badge?.label ?? 'Unknown', tone: tone(d.auth_badge?.tone), certificate_bound: d.auth_method === 'mtls' },
    network: { observed: !!d.network_observed, label: d.network_badge?.label ?? 'No network observation', mac_address: d.mac_address || null, ip_address: d.ip_address || null, hostname: d.hostname || null },
    runtime: { conflict_active: !!d.conflict_active, behavior_mode: d.behavior_mode || null, conflicting_purposes: d.conflicting_purposes ?? [] },
    badges: (d.list_badges ?? []).map((b) => ({ label: b.label, tone: tone(b.tone) })),
  }
}
