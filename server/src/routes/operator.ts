import type { FastifyInstance } from 'fastify'
import type { HealthCheck, Overview, Policy, Preset, PublishResult, SystemStatus, UnmanagedDevice } from '../../../shared/types'
import { compileHouseholdPolicy, newPolicyId } from '../compiler'
import { httpError, requireOperator, type AppContext } from '../context'
import { GatewayError } from '../gateway'
import { tupleKey } from '../live'
import { idParams } from './household'

/**
 * The CableLabs dashboard's operator views, served from the gateway's operator routes: readiness
 * summary, service health, the household policy and its presets, publication, and manual
 * disassociation.
 */

/** Turns a gateway failure into an answer the browser can show, without leaking gateway internals. */
function unavailable(e: unknown): never {
  if (e instanceof GatewayError) {
    if (e.status === 401 || e.status === 403) throw httpError(502, 'The gateway refused app-api’s operator credentials.')
    if (e.status === 0) throw httpError(503, 'The PPD gateway is not reachable right now.')
    if (e.status === 400 || e.status === 422) throw httpError(422, `The gateway rejected the policy: ${e.message.replace(/^Gateway \S+ \S+: /, '')}`)
    throw httpError(502, 'The PPD gateway could not complete the request.')
  }
  throw e
}

export function operatorRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/me', async (req) => ({ ...req.identity!, simulator: !!ctx.simulator }))

  app.get('/api/network', async (): Promise<UnmanagedDevice[]> => {
    const snap = await ctx.live.snapshot().catch(unavailable)
    return ctx.live.unmanaged(snap.unmanaged)
  })

  app.get('/api/overview', async (): Promise<Overview> => {
    const meta = await ctx.gateway.serviceMetadata().catch(() => null)
    try {
      const { summary: s } = await ctx.live.snapshot()
      const n = (v: number | undefined) => v ?? 0
      return {
        gateway: { reachable: true, security: meta?.security_profile ?? 'unknown', mutual_tls_required: !!s.mutual_tls_required, tls_enabled: !!s.tls_enabled, freshness_interval: s.association_freshness_interval ?? null, error: null },
        counts: {
          known: n(s.known_devices), registered: n(s.registered_devices), declared: n(s.declared_devices), policy_retrieved: n(s.policy_retrieved_devices),
          acknowledged: n(s.acknowledged_devices), associated: n(s.associated_devices), needs_reassociation: n(s.needs_reassociation_devices),
          stale: n(s.stale_association_devices), broken: n(s.broken_association_devices), policy_conflict: n(s.policy_conflict_devices),
          overrides: n(s.override_devices), authenticated: n(s.authenticated_devices), compatibility_mode: n(s.compatibility_mode_devices),
          network_observed: n(s.network_observed_devices), unmanaged: n(s.unmanaged_devices),
          // The CableLabs dashboard's "Need attention": known devices not currently associated, plus runtime conflicts.
          need_attention: Math.max(n(s.known_devices) - n(s.associated_devices), 0) + n(s.policy_conflict_devices),
        },
        household_policy: { policy_id: s.default_policy_id ?? null, updated_at: s.default_policy_updated_at ?? null, published_by_app: !!s.default_policy_id && ctx.store.publishedByApp(s.default_policy_id) },
        updated_at: new Date().toISOString(),
      }
    } catch (e) {
      const zero = { known: 0, registered: 0, declared: 0, policy_retrieved: 0, acknowledged: 0, associated: 0, needs_reassociation: 0, stale: 0, broken: 0, policy_conflict: 0, overrides: 0, authenticated: 0, compatibility_mode: 0, network_observed: 0, unmanaged: 0, need_attention: 0 }
      return {
        gateway: { reachable: false, security: 'unknown', mutual_tls_required: false, tls_enabled: false, freshness_interval: null, error: e instanceof Error ? e.message : 'unreachable' },
        counts: zero,
        household_policy: { policy_id: null, updated_at: null, published_by_app: false },
        updated_at: new Date().toISOString(),
      }
    }
  })

  app.get('/api/system-status', async (): Promise<SystemStatus> => {
    const checks: HealthCheck[] = []
    const gw = await ctx.gateway.health()
    checks.push({ id: 'app-database', group: 'app', label: 'Household database', status: ctx.store.ping() ? 'pass' : 'fail', detail: `Revision ${ctx.store.revision()}.` })
    checks.push({ id: 'app-gateway', group: 'app', label: 'Connection to the PPD gateway', status: gw.reachable ? 'pass' : 'fail', detail: gw.reachable ? `Reached ${gw.url}.` : `Could not reach the gateway: ${gw.error}.` })
    checks.push({
      id: 'app-auth', group: 'app', label: 'Sign-in',
      status: ctx.config.appEnv === 'production' ? 'pass' : 'warn',
      detail: ctx.config.appEnv === 'production' ? 'Cloudflare Access tokens are checked on every request.' : 'Development mode: everyone is treated as the household operator.',
    })
    checks.push({
      id: 'app-demo-callbacks', group: 'app', label: 'Device telemetry and commands',
      status: ctx.config.internalServiceToken ? 'pass' : 'warn',
      detail: ctx.config.internalServiceToken ? 'The gateway can relay demo telemetry and command polling.' : 'INTERNAL_SERVICE_TOKEN is not set, so demo telemetry and commands are off.',
    })
    if (gw.reachable) {
      try {
        for (const c of await ctx.gateway.checks()) {
          if (c.category === 'network' && !ctx.config.routerChecks) continue
          checks.push({ id: c.check_id, group: c.category === 'repository' ? 'repository' : 'gateway', label: c.name, status: c.status, detail: c.detail })
        }
      } catch (e) {
        checks.push({ id: 'gateway-checks', group: 'gateway', label: 'Gateway service checks', status: 'fail', detail: e instanceof Error ? e.message : 'unavailable' })
      }
    }
    return { checks, updated_at: new Date().toISOString() }
  })

  app.get('/api/household/published', async (): Promise<Policy | null> => ctx.gateway.defaultPolicy().catch(unavailable))

  app.get('/api/household/preview', async () => {
    const [household, devices, published] = await Promise.all([ctx.household(), ctx.liveDevices().catch(unavailable), ctx.gateway.defaultPolicy().catch(unavailable)])
    return compileHouseholdPolicy(household, devices, published).preview
  })

  app.post('/api/household/publish', async (req): Promise<PublishResult> => {
    requireOperator(req)
    const [household, devices, published] = await Promise.all([ctx.household(), ctx.liveDevices().catch(unavailable), ctx.gateway.defaultPolicy().catch(unavailable)])
    const { preview, policy } = compileHouseholdPolicy(household, devices, published)
    if (preview.blocked.length) {
      throw httpError(409, `${preview.blocked.length} data ${preview.blocked.length === 1 ? 'flow waits' : 'flows wait'} for your decision before the rules can be sent.`)
    }
    const wire: Policy = { policy_id: newPolicyId(), ...policy }
    await ctx.gateway.putDefaultPolicy(wire).catch(unavailable)
    // Read back what the repository stored rather than assuming the write meant what we sent.
    const stored = await ctx.gateway.defaultPolicy().catch(unavailable)
    const same = stored?.policy_id === wire.policy_id && stored.rules.length === wire.rules.length && wire.rules.every((r) => stored.rules.some((s) => tupleKey(s) === tupleKey(r) && s.effect === r.effect))
    if (!same) throw httpError(502, 'The gateway stored a different policy than the one sent. Nothing was recorded; try again.')
    ctx.store.recordPublication(wire, ctx.store.revision(), req.identity?.email ?? 'unknown')
    ctx.live.invalidate()
    return { policy_id: wire.policy_id, rules: wire.rules.length, published_at: new Date().toISOString(), preview }
  })

  app.get('/api/presets', async (): Promise<Preset[]> => {
    const [examples, current] = await Promise.all([ctx.gateway.examples().catch(unavailable), ctx.gateway.defaultPolicy().catch(() => null)])
    return examples.map((e) => ({ name: e.name, title: e.title, summary: e.summary, policy_id: e.policy_id, current: current?.policy_id === e.policy_id }))
  })

  app.post<{ Params: { name: string } }>(
    '/api/presets/:name/apply',
    { schema: { params: { type: 'object', required: ['name'], properties: { name: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' } } } } },
    async (req): Promise<Policy> => {
      requireOperator(req)
      await ctx.gateway.applyExample(req.params.name).catch(unavailable)
      ctx.store.audit('apply_preset', req.params.name, req.identity?.email)
      ctx.live.invalidate()
      const stored = await ctx.gateway.defaultPolicy().catch(unavailable)
      if (!stored) throw httpError(502, 'The gateway did not return the household policy after loading the preset.')
      return stored
    },
  )

  app.post<{ Params: { id: string } }>('/api/devices/:id/disassociate', { schema: { params: idParams } }, async (req, reply) => {
    requireOperator(req)
    await ctx.gateway.disassociate(req.params.id, 'household operator requested reassociation from the web app').catch(unavailable)
    ctx.store.audit('disassociate', req.params.id, req.identity?.email)
    ctx.live.invalidate()
    reply.status(204)
  })
}
