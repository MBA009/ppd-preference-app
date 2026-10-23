import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TAXONOMY_RELEASE } from '../../../shared/taxonomy'
import type { SimDevice } from '../../../shared/types'
import type { SimulatorConfig } from '../config'
import type { Fixtures } from '../fixtures'
import type { LiveDirectory, RegistryEntry } from '../live'
import type { HouseholdStore } from '../store'
import { Participant, type ParticipantIdentity, type ParticipantTls } from './participant'

/**
 * The demo device simulator. Each simulated device comes from a research fixture and either joins through
 * PPD (a Participant talking to the gateway like a real device) or only appears on the home network.
 * Network presence is a line in the DHCP lease file the gateway reads, so the gateway sees simulated devices
 * exactly as it would see real ones on its router. Nothing here writes into the household directly: the app
 * learns about simulated devices from the gateway.
 */

type Wanted = SimDevice['wanted']

interface SimSlot {
  entry: RegistryEntry & { simulator: NonNullable<RegistryEntry['simulator']> }
  wanted: Wanted
  participant: Participant | null
}

const FIELDS = ['data_type', 'purpose', 'action', 'source', 'handling_context'] as const

export class Simulator {
  private readonly slots = new Map<string, SimSlot>()

  constructor(
    private readonly config: SimulatorConfig,
    private readonly fixtures: Fixtures,
    registry: RegistryEntry[],
    private readonly store: HouseholdStore,
    private readonly live: LiveDirectory,
    private readonly tlsServerName: string,
  ) {
    for (const entry of registry) {
      if (entry.kind !== 'simulated' || !entry.simulator || !entry.fixture || !fixtures.devices.has(entry.fixture)) continue
      this.slots.set(entry.device_id, { entry: entry as SimSlot['entry'], wanted: 'off', participant: null })
    }
  }

  /** Puts every device back the way the presenter last left it (after an app-api restart). */
  restore(): void {
    const wanted = this.store.simWanted()
    for (const [id, slot] of this.slots) {
      const w = wanted.get(id) as Wanted | undefined
      if (!w || w === 'off') continue
      slot.wanted = w
      if (w === 'connected') this.participant(slot).start()
    }
    this.writeLeases()
  }

  list(): SimDevice[] {
    return [...this.slots.values()].map((s) => this.view(s))
  }

  has(id: string): boolean {
    return this.slots.has(id)
  }

  /** Joins the network (DHCP lease) and starts participating in PPD. */
  connect(id: string): SimDevice {
    const slot = this.slot(id, 'ppd')
    this.setWanted(slot, 'connected')
    this.participant(slot).start()
    return this.view(slot)
  }

  /** Unplugged: stops renewing and leaves the network. The gateway keeps its record, which goes stale. */
  disconnect(id: string): SimDevice {
    const slot = this.slot(id, 'ppd')
    slot.participant?.stop()
    this.setWanted(slot, 'disconnected')
    return this.view(slot)
  }

  /** Network-only devices: appear on or leave the home network (unmanaged on the gateway). */
  network(id: string, present: boolean): SimDevice {
    const slot = this.slot(id, 'network')
    this.setWanted(slot, present ? 'on_network' : 'off')
    return this.view(slot)
  }

  /** Everything off: participants stopped, simulated leases removed. */
  reset(): SimDevice[] {
    for (const slot of this.slots.values()) {
      slot.participant?.stop()
      slot.wanted = 'off'
      this.store.setSimWanted(slot.entry.device_id, 'off')
    }
    this.writeLeases()
    return this.list()
  }

  close(): void {
    for (const slot of this.slots.values()) slot.participant?.stop()
  }

  private slot(id: string, mode: 'ppd' | 'network'): SimSlot {
    const slot = this.slots.get(id)
    if (!slot) throw Object.assign(new Error(`No simulated device ${id}.`), { statusCode: 404 })
    if (slot.entry.simulator.mode !== mode) {
      throw Object.assign(new Error(mode === 'ppd' ? `${id} does not support PPD; use Join network.` : `${id} joins through PPD; use Connect.`), { statusCode: 400 })
    }
    return slot
  }

  private setWanted(slot: SimSlot, wanted: Wanted): void {
    slot.wanted = wanted
    this.store.setSimWanted(slot.entry.device_id, wanted)
    this.writeLeases()
    this.live.invalidate()
  }

  private participant(slot: SimSlot): Participant {
    slot.participant ??= new Participant(this.config.gatewayUrl, this.identity(slot), this.tls(slot.entry.device_id), () => this.live.invalidate())
    return slot.participant
  }

  /** Registration and declaration from the research fixture: one statement per source-linked flow, core terms only. */
  private identity(slot: SimSlot): ParticipantIdentity {
    const fixture = this.fixtures.devices.get(slot.entry.fixture!)!
    const sim = slot.entry.simulator
    const statements = fixture.flows
      .filter((f) => f.evidence === 'source_linked')
      .map((f) => {
        const statement: Record<string, unknown> = { statement_id: f.id.slice(f.id.indexOf('.') + 1) }
        for (const k of FIELDS) statement[k] = f.taxonomy[k]
        if (Object.keys(f.taxonomy.constraints).length) statement.constraints = f.taxonomy.constraints
        return statement
      })
    return {
      deviceId: slot.entry.device_id,
      registration: {
        device_id: slot.entry.device_id,
        manufacturer: fixture.name.split(' ')[0],
        model: fixture.name,
        firmware_version: 'simulated-1',
        mac_address: sim.mac,
        ip_address: sim.ip,
        hostname: sim.hostname,
      },
      declaration: { device_id: slot.entry.device_id, declaration_id: `${fixture.declaration_id_example}-declaration`, taxonomy: { release: TAXONOMY_RELEASE }, statements },
    }
  }

  private tls(deviceId: string): ParticipantTls | null {
    if (!this.config.gatewayUrl.startsWith('https://')) return null
    const read = (f: string) => {
      try {
        return readFileSync(f)
      } catch {
        return undefined
      }
    }
    return {
      ca: this.config.caFile ? read(this.config.caFile) : undefined,
      cert: this.config.certDir ? read(path.join(this.config.certDir, `${deviceId}-cert.pem`)) : undefined,
      key: this.config.certDir ? read(path.join(this.config.certDir, `${deviceId}-key.pem`)) : undefined,
      servername: this.tlsServerName || undefined,
    }
  }

  private view(slot: SimSlot): SimDevice {
    const fixture = this.fixtures.devices.get(slot.entry.fixture!)!
    const sim = slot.entry.simulator
    const p = slot.participant
    const state: SimDevice['state'] =
      sim.mode === 'network'
        ? slot.wanted === 'on_network' ? 'on_network' : 'off'
        : slot.wanted === 'off' ? 'off' : p?.active ? (p.state === 'paused' ? 'joining' : p.state) : 'paused'
    return {
      id: slot.entry.device_id,
      name: fixture.name,
      short_name: fixture.short_name,
      icon: fixture.icon,
      mode: sim.mode,
      wanted: slot.wanted,
      state,
      hostname: sim.hostname,
      ip_address: sim.ip,
      mac_address: sim.mac,
      last_event: p?.lastEvent ?? (state === 'on_network' ? 'On the home network' : null),
      last_event_at: p?.lastEventAt ?? null,
      last_error: p?.lastError ?? null,
    }
  }

  /**
   * Writes the simulated devices that are on the network into the gateway's DHCP lease file
   * (dnsmasq format: <expiry> <mac> <ip> <hostname> <client-id>). Written whole and renamed into place.
   */
  private writeLeases(): void {
    const expires = Math.floor(Date.now() / 1000) + 24 * 3600
    const lines = [...this.slots.values()]
      .filter((s) => s.wanted === 'connected' || s.wanted === 'on_network')
      .map((s) => `${expires} ${s.entry.simulator.mac} ${s.entry.simulator.ip} ${s.entry.simulator.hostname} *`)
    mkdirSync(path.dirname(this.config.leasesFile), { recursive: true })
    const tmp = `${this.config.leasesFile}.tmp`
    writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '')
    renameSync(tmp, this.config.leasesFile)
  }
}
