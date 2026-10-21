import type { FastifyReply, FastifyRequest } from 'fastify'
import { evaluateDevice } from '../../shared/engine'
import * as hh from '../../shared/household'
import type { Device, DeviceSummary, Household } from '../../shared/types'
import type { Authenticator, Identity } from './auth'
import type { Config } from './config'
import type { Fixtures } from './fixtures'
import type { GatewayClient } from './gateway'
import type { LiveDirectory } from './live'
import type { HouseholdStore } from './store'

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null
  }
}

/** Everything a route needs: settings, stores, the gateway, and the household helpers built on them. */
export class AppContext {
  constructor(
    readonly config: Config,
    readonly fixtures: Fixtures,
    readonly store: HouseholdStore,
    readonly gateway: GatewayClient,
    readonly live: LiveDirectory,
    readonly auth: Authenticator,
  ) {}

  /** The first-launch household: the fixture devices, except those a simulated participant stands in for. */
  seed = (): Household => {
    const simulated = this.live.simulatedFixtureIds()
    return hh.seedHousehold({ devices: this.fixtures.household.devices.filter((d) => !simulated.has(d.device_id)) })
  }

  change(req: FastifyRequest, action: string, fn: (h: Household) => Household, detail?: string): Household {
    return this.store.update(action, this.seed, fn, detail, req.identity?.email)
  }

  /**
   * The household, after adding any device that registered with the gateway since we last looked: a PPD
   * device that joins the home network is in the home, and the app shows it as "joined". Works without
   * the gateway (the household is then just what is stored).
   */
  async household(): Promise<Household> {
    let devices: { device_id: string; registered_at?: string }[] = []
    try {
      devices = await this.live.gatewayDevices()
    } catch {
      /* gateway unreachable: show the stored household */
    }
    const fresh = devices.filter((d) => d.registered_at && this.store.liveSeen(d.device_id) !== d.registered_at)
    if (!fresh.length) return this.store.get() ?? this.store.update('seed', this.seed, (h) => h)
    return this.store.update(
      'device_joined',
      this.seed,
      (h) => {
        let next = h
        for (const d of fresh) {
          this.store.markLiveSeen(d.device_id, d.registered_at!)
          next = hh.addDevice(next, d.device_id, { joined: true })
        }
        return next
      },
      fresh.map((d) => d.device_id).join(', '),
      'gateway',
    )
  }

  /** The library: devices the gateway knows first, then the researched fixtures. */
  async library(): Promise<DeviceSummary[]> {
    let live: DeviceSummary[] = []
    try {
      live = (await this.live.gatewayDevices()).map((d) => this.live.summary(d))
    } catch {
      /* gateway unreachable */
    }
    return [...live, ...this.fixtures.library.map((d) => ({ ...d, kind: 'research' as const }))]
  }

  /** One device with its verdicts, from the gateway or the fixtures; undefined when unknown. */
  async device(id: string): Promise<Device | undefined> {
    const rules = (await this.household()).rules
    const raw = this.fixtures.devices.get(id)
    if (raw) return hh.withFreshDeclaration(evaluateDevice({ ...raw, kind: 'research' }, rules))
    const snap = await this.live.snapshot().catch(() => null)
    const gd = snap?.devices.find((d) => d.device_id === id)
    return gd ? this.live.device(gd, rules, this.publishedPolicyId(snap!.summary.default_policy_id)) : undefined
  }

  /** Every device the gateway knows, evaluated. Throws when the gateway is unreachable. */
  async liveDevices(): Promise<Device[]> {
    const rules = (await this.household()).rules
    const snap = await this.live.snapshot()
    return snap.devices.map((d) => this.live.device(d, rules, this.publishedPolicyId(snap.summary.default_policy_id)))
  }

  /** The household policy id devices should pick up: whatever the gateway serves now. */
  publishedPolicyId(defaultPolicyId: string | undefined): string | null {
    return defaultPolicyId || null
  }

  async knownDevice(id: string): Promise<boolean> {
    if (this.fixtures.devices.has(id)) return true
    try {
      return (await this.live.gatewayDevices()).some((d) => d.device_id === id)
    } catch {
      return false
    }
  }
}

export const httpError = (status: number, message: string) => Object.assign(new Error(message), { statusCode: status })

/** Route guard: only operators may change the published policy or drive devices. */
export function requireOperator(req: FastifyRequest): void {
  if (req.identity?.role !== 'operator') throw httpError(403, 'Only household operators can do this.')
}

export type Reply = FastifyReply
