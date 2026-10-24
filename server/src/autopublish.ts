import type { Policy, PublishPreview, PublishResult, SyncState } from '../../shared/types'
import { compileHouseholdPolicy, newPolicyId } from './compiler'
import type { AppContext } from './context'
import { tupleKey } from './live'

/**
 * Keeps the gateway's household policy in step with the household, without a "send" step: the preset is
 * meant to cover whatever devices join, so devices get the household's rules on their own.
 *
 * sync() compiles the household's rules for the devices the gateway knows and publishes only when the
 * result differs from what the gateway serves. It runs after every rule or preset change, and on a timer
 * so that devices joining or leaving are covered. Nothing is sent before the household has a preset.
 * Runs never overlap.
 */

const changesIn = (p: PublishPreview) => p.rules.filter((r) => r.change !== 'unchanged').length + p.removed.length

/** Compiles the household's rules, sends them to the gateway, reads them back and records the publication. */
export async function publishHousehold(ctx: AppContext, by: string): Promise<PublishResult> {
  const [household, devices, published] = await Promise.all([ctx.household(), ctx.liveDevices(), ctx.gateway.defaultPolicy()])
  const { preview, policy } = compileHouseholdPolicy(household, devices, published)
  const wire: Policy = { policy_id: newPolicyId(), ...policy }
  await ctx.gateway.putDefaultPolicy(wire)
  // Read back what the repository stored rather than assuming the write meant what we sent.
  const stored = await ctx.gateway.defaultPolicy()
  const same = stored?.policy_id === wire.policy_id && stored.rules.length === wire.rules.length && wire.rules.every((r) => stored.rules.some((s) => tupleKey(s) === tupleKey(r) && s.effect === r.effect))
  if (!same) throw new Error('The gateway stored a different policy than the one sent.')
  ctx.store.recordPublication(wire, ctx.store.revision(), by)
  ctx.live.invalidate()
  return { policy_id: wire.policy_id, rules: wire.rules.length, published_at: new Date().toISOString(), preview }
}

export class AutoPublisher {
  readonly state: SyncState = { last_run_at: null, last_sent: null, last_error: null }
  private running: Promise<void> = Promise.resolve()
  private busy = false
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly ctx: AppContext, private readonly log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {}

  /** Publishes when the household's compiled rules differ from the gateway's. Waits for any run in progress first. */
  sync(reason: string): Promise<void> {
    this.running = this.running.then(() => this.run(reason))
    return this.running
  }

  /** Checks every `ms` milliseconds; a tick is skipped while a run is in progress. */
  start(ms: number): void {
    if (ms <= 0 || this.timer) return
    this.timer = setInterval(() => { if (!this.busy) void this.sync('timer') }, ms)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async run(reason: string): Promise<void> {
    this.busy = true
    try {
      const household = await this.ctx.household()
      if (!household.preset_id) return
      const [devices, published] = await Promise.all([this.ctx.liveDevices(), this.ctx.gateway.defaultPolicy()])
      const { preview } = compileHouseholdPolicy(household, devices, published)
      // A gateway that serves no policy yet gets one as soon as a device is there to need it.
      if (changesIn(preview) === 0 && (published || !devices.length)) {
        this.state.last_error = null
        return
      }
      const result = await publishHousehold(this.ctx, 'auto')
      this.state.last_sent = { policy_id: result.policy_id, rules: result.rules, at: result.published_at }
      this.state.last_error = null
      this.log.info({ reason, policy_id: result.policy_id, rules: result.rules, devices: devices.length }, 'household policy sent automatically')
    } catch (e) {
      this.state.last_error = e instanceof Error ? e.message : String(e)
      this.log.warn({ reason, err: this.state.last_error }, 'automatic household policy send failed')
    } finally {
      this.state.last_run_at = new Date().toISOString()
      this.busy = false
    }
  }
}
