import Fastify, { type FastifyInstance } from 'fastify'
import { Authenticator } from './auth'
import type { Config } from './config'
import { AutoPublisher } from './autopublish'
import { AppContext, httpError } from './context'
import type { Fixtures } from './fixtures'
import { GatewayClient } from './gateway'
import { LiveDirectory, loadRegistry } from './live'
import { demoRoutes } from './routes/demo'
import { householdRoutes } from './routes/household'
import { operatorRoutes } from './routes/operator'
import { simulatorRoutes } from './routes/simulator'
import { Simulator } from './simulator'
import type { HouseholdStore } from './store'

/**
 * app-api's HTTP interface: the web app's only backend. Routes map to the PpdApi methods in
 * shared/types.ts. Every /api route except /api/health needs a signed-in person; state-changing
 * routes also need the app's own request header, which a cross-site form or script cannot send
 * without a CORS preflight that app-api never grants.
 */

export interface Overrides { gateway?: GatewayClient; auth?: Authenticator }

export function buildApp(config: Config, fixtures: Fixtures, store: HouseholdStore, overrides: Overrides = {}): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["cf-access-jwt-assertion"]'] }, bodyLimit: 512 * 1024 })
  const gateway = overrides.gateway ?? new GatewayClient(config.gateway)
  const ctx = new AppContext(config, fixtures, store, gateway, new LiveDirectory(gateway, fixtures, loadRegistry(config.deviceRegistryPath)), overrides.auth ?? new Authenticator(config))

  app.decorateRequest('identity', null)

  ctx.publisher = new AutoPublisher(ctx, app.log)
  app.addHook('onReady', async () => ctx.publisher.start(config.autoPublishIntervalMs))
  app.addHook('onClose', async () => ctx.publisher.stop())

  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0]
    if (!path.startsWith('/api/') || path === '/api/health') return
    req.identity = await ctx.auth.identify(req.headers)
    if (!req.identity) throw httpError(401, 'Sign in to use the household app.')
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-ppd-client'] !== 'web') throw httpError(403, 'This request did not come from the household app.')
  })

  // Household and policy data must never be cached by the browser, the service worker or Cloudflare.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = err.validation ? 400 : err.statusCode && err.statusCode < 600 ? err.statusCode : 500
    if (status >= 500) req.log.error(err)
    reply.status(status).send({ message: status === 500 ? 'Something went wrong on the server.' : err.message })
  })

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ message: 'No such API route.' })
  })

  app.get('/api/health', async (_req, reply) => {
    const database = store.ping()
    const gw = await gateway.health()
    // app-api can serve the household without the gateway, so only the database decides readiness.
    reply.status(database ? 200 : 503)
    return { status: database ? 'ok' : 'unavailable', database, household_revision: store.revision(), fixtures: { devices: fixtures.devices.size }, gateway: gw }
  })

  householdRoutes(app, ctx)
  operatorRoutes(app, ctx)
  demoRoutes(app, ctx)

  if (config.simulator.enabled) {
    const sim = new Simulator(config.simulator, fixtures, ctx.live.registry, store, ctx.live, config.gateway.tlsServerName)
    ctx.simulator = sim
    simulatorRoutes(app, ctx, sim)
    app.addHook('onReady', async () => sim.restore())
    app.addHook('onClose', async () => sim.close())
  }
  return app
}
