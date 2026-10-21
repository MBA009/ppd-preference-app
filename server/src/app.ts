import Fastify, { type FastifyInstance } from 'fastify'
import { evaluateDevice } from '../../shared/engine'
import * as hh from '../../shared/household'
import type { Answers, Decision, Household, Profile, Rule } from '../../shared/types'
import type { Config } from './config'
import type { Fixtures } from './fixtures'
import { checkGateway } from './gateway'
import type { HouseholdStore } from './store'

/**
 * app-api's HTTP interface. Every route matches one PpdApi method (shared/types.ts), so the web app's
 * httpClient.ts is a thin mapping. Verdicts are computed here, from the stored household rules.
 */

const stringList = { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 50 } as const

const ruleSchema = {
  type: 'object',
  required: ['id', 'title', 'effect', 'scope', 'enabled', 'origin'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', maxLength: 500 },
    effect: { enum: ['allow', 'ask', 'dont_allow'] },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: { data_type: stringList, purpose: stringList, handling_context: stringList, action: stringList, constraints: stringList },
    },
    enabled: { type: 'boolean' },
    origin: { type: 'object', required: ['kind'], properties: { kind: { enum: ['questionnaire', 'custom'] } } },
  },
} as const

const deviceBody = {
  type: 'object',
  required: ['device_id'],
  properties: { device_id: { type: 'string', minLength: 1, maxLength: 200 }, joined: { type: 'boolean' } },
} as const

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } as const

export function buildApp(config: Config, fixtures: Fixtures, store: HouseholdStore): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 512 * 1024 })

  const seed = () => hh.seedHousehold(fixtures.household)
  const household = (): Household => store.get() ?? store.update('seed', seed, (h) => h)
  const change = (action: string, fn: (h: Household) => Household, detail?: string) => store.update(action, seed, fn, detail)

  const notFound = (what: string) => Object.assign(new Error(`${what} not found.`), { statusCode: 404 })
  const requireDevice = (id: string) => {
    if (!fixtures.devices.has(id)) throw notFound(`Device ${id}`)
  }

  // Household and policy data must never be cached by the browser, the service worker or Cloudflare.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store')
  })

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    const status = err.validation ? 400 : err.statusCode && err.statusCode < 500 ? err.statusCode : 500
    if (status >= 500) req.log.error(err)
    reply.status(status).send({ message: status >= 500 ? 'Something went wrong on the server.' : err.message })
  })

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ message: 'No such API route.' })
  })

  app.get('/api/health', async (_req, reply) => {
    const database = store.ping()
    const gateway = await checkGateway(config.gatewayUrl)
    // app-api can serve the household without the gateway, so only the database decides readiness.
    reply.status(database ? 200 : 503)
    return { status: database ? 'ok' : 'unavailable', database, household_revision: store.revision(), fixtures: { devices: fixtures.devices.size }, gateway }
  })

  app.get('/api/questionnaire', async () => fixtures.questionnaire)

  app.get('/api/library', async () => fixtures.library)

  app.get<{ Params: { id: string } }>('/api/devices/:id', { schema: { params: idParams } }, async (req) => {
    const raw = fixtures.devices.get(req.params.id)
    if (!raw) throw notFound(`Device ${req.params.id}`)
    return hh.withFreshDeclaration(evaluateDevice(raw, household().rules))
  })

  app.post<{ Body: { payload: string } }>(
    '/api/codes/resolve',
    { schema: { body: { type: 'object', required: ['payload'], properties: { payload: { type: 'string', maxLength: 2048 } } } } },
    async (req) => hh.resolveCode(req.body.payload, fixtures.codes),
  )

  app.get('/api/household', async () => household())

  app.get('/api/household/rules', async () => household().rules)

  app.put<{ Body: { answers: Answers; rules: Rule[]; profile: Profile } }>(
    '/api/household/policy',
    {
      schema: {
        body: {
          type: 'object',
          required: ['answers', 'rules', 'profile'],
          properties: { answers: { type: 'object' }, rules: { type: 'array', items: ruleSchema, maxItems: 500 }, profile: { type: 'object' } },
        },
      },
    },
    async (req) => change('save_policy', (h) => hh.savePolicy(h, req.body), `${req.body.rules.length} rules`),
  )

  app.put<{ Params: { id: string }; Body: Rule }>('/api/household/rules/:id', { schema: { params: idParams, body: ruleSchema } }, async (req) => {
    if (req.body.id !== req.params.id) throw Object.assign(new Error('The rule id in the body does not match the URL.'), { statusCode: 400 })
    return change('upsert_rule', (h) => hh.upsertRule(h, req.body), req.body.id)
  })

  app.delete<{ Params: { id: string } }>('/api/household/rules/:id', { schema: { params: idParams } }, async (req) =>
    change('delete_rule', (h) => hh.deleteRule(h, req.params.id), req.params.id),
  )

  app.post<{ Body: { device_id: string; joined?: boolean } }>('/api/household/devices', { schema: { body: deviceBody } }, async (req) => {
    requireDevice(req.body.device_id)
    return change('add_device', (h) => hh.addDevice(h, req.body.device_id, { joined: req.body.joined }), req.body.device_id)
  })

  app.delete<{ Params: { id: string } }>('/api/household/devices/:id', { schema: { params: idParams } }, async (req) =>
    change('remove_device', (h) => hh.removeDevice(h, req.params.id), req.params.id),
  )

  app.post<{ Params: { id: string } }>('/api/household/devices/:id/seen', { schema: { params: idParams } }, async (req) =>
    change('mark_joined_seen', (h) => hh.markJoinedSeen(h, req.params.id), req.params.id),
  )

  app.post<{ Body: { device_id: string } }>('/api/household/saved', { schema: { body: deviceBody } }, async (req) => {
    requireDevice(req.body.device_id)
    return change('save_for_later', (h) => hh.saveForLater(h, req.body.device_id), req.body.device_id)
  })

  app.post<{ Body: Omit<Decision, 'decided_at'> }>(
    '/api/household/decisions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['flow_id', 'device_id', 'preference', 'remember_similar', 'core_group_id'],
          properties: {
            flow_id: { type: 'string', minLength: 1, maxLength: 300 },
            device_id: { type: 'string', minLength: 1, maxLength: 200 },
            preference: { enum: ['allow', 'allow_with_limits', 'dont_allow'] },
            keep: { enum: ['briefly', 'until_deleted'] },
            region: { type: 'string', maxLength: 100 },
            remember_similar: { type: 'boolean' },
            core_group_id: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (req) => {
      const device = fixtures.devices.get(req.body.device_id)
      if (!device) throw notFound(`Device ${req.body.device_id}`)
      if (!device.flows.some((f) => f.id === req.body.flow_id)) throw notFound(`Flow ${req.body.flow_id}`)
      return change('save_decision', (h) => hh.saveDecision(h, req.body), req.body.flow_id)
    },
  )

  app.post<{ Body: { mode: 'seed' | 'empty' } }>(
    '/api/household/reset',
    { schema: { body: { type: 'object', required: ['mode'], properties: { mode: { enum: ['seed', 'empty'] } } } } },
    // Both modes return to first launch: no answers and no rules yet.
    async (req) => change('reset', () => (req.body.mode === 'seed' ? seed() : hh.blankHousehold()), req.body.mode),
  )

  return app
}
