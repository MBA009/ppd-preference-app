import type { FastifyInstance } from 'fastify'
import * as hh from '../../../shared/household'
import type { Answers, Decision, Profile, Rule } from '../../../shared/types'
import { httpError, type AppContext } from '../context'

/** The household: devices in the home, saved decisions, questionnaire answers and authoring rules. */

const stringList = { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 50 } as const

export const ruleSchema = {
  type: 'object',
  required: ['id', 'title', 'effect', 'scope', 'enabled', 'origin'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', maxLength: 500 },
    effect: { enum: ['allow', 'ask', 'dont_allow'] },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: { data_type: stringList, purpose: stringList, handling_context: stringList, action: stringList, source: stringList, constraints: stringList },
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

export const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } as const

const profileSchema = {
  type: 'object',
  properties: { summary_frequency: { enum: ['daily', 'monthly', 'yearly', 'never'] }, warn_on_conflict: { type: 'boolean' } },
} as const

const answersSchema = {
  type: 'object',
  maxProperties: 50,
  additionalProperties: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'object', maxProperties: 50, additionalProperties: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'boolean' }] } }] },
} as const

export function householdRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireDevice = async (id: string) => {
    if (!(await ctx.knownDevice(id))) throw httpError(404, `Device ${id} not found.`)
  }

  app.get('/api/questionnaire', async () => ctx.fixtures.questionnaire)

  app.get('/api/household', async () => ctx.household())

  app.get('/api/household/rules', async () => (await ctx.household()).rules)

  app.put<{ Body: { answers: Answers; rules: Rule[]; profile: Profile } }>(
    '/api/household/policy',
    {
      schema: {
        body: {
          type: 'object',
          required: ['answers', 'rules', 'profile'],
          properties: { answers: answersSchema, rules: { type: 'array', items: ruleSchema, maxItems: 500 }, profile: profileSchema },
        },
      },
    },
    async (req) => ctx.change(req, 'save_policy', (h) => hh.savePolicy(h, req.body), `${req.body.rules.length} rules`),
  )

  app.put<{ Params: { id: string }; Body: Rule }>('/api/household/rules/:id', { schema: { params: idParams, body: ruleSchema } }, async (req) => {
    if (req.body.id !== req.params.id) throw httpError(400, 'The rule id in the body does not match the URL.')
    return ctx.change(req, 'upsert_rule', (h) => hh.upsertRule(h, req.body), req.body.id)
  })

  app.delete<{ Params: { id: string } }>('/api/household/rules/:id', { schema: { params: idParams } }, async (req) =>
    ctx.change(req, 'delete_rule', (h) => hh.deleteRule(h, req.params.id), req.params.id),
  )

  app.post<{ Body: { device_id: string; joined?: boolean } }>('/api/household/devices', { schema: { body: deviceBody } }, async (req) => {
    await requireDevice(req.body.device_id)
    return ctx.change(req, 'add_device', (h) => hh.addDevice(h, req.body.device_id, { joined: req.body.joined }), req.body.device_id)
  })

  app.delete<{ Params: { id: string } }>('/api/household/devices/:id', { schema: { params: idParams } }, async (req) =>
    ctx.change(req, 'remove_device', (h) => hh.removeDevice(h, req.params.id), req.params.id),
  )

  app.post<{ Params: { id: string } }>('/api/household/devices/:id/seen', { schema: { params: idParams } }, async (req) =>
    ctx.change(req, 'mark_joined_seen', (h) => hh.markJoinedSeen(h, req.params.id), req.params.id),
  )

  app.post<{ Body: { device_id: string } }>('/api/household/saved', { schema: { body: deviceBody } }, async (req) => {
    await requireDevice(req.body.device_id)
    return ctx.change(req, 'save_for_later', (h) => hh.saveForLater(h, req.body.device_id), req.body.device_id)
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
      const device = await ctx.device(req.body.device_id)
      if (!device) throw httpError(404, `Device ${req.body.device_id} not found.`)
      if (!device.flows.some((f) => f.id === req.body.flow_id)) throw httpError(404, `Flow ${req.body.flow_id} not found.`)
      return ctx.change(req, 'save_decision', (h) => hh.saveDecision(h, req.body), req.body.flow_id)
    },
  )

  app.post<{ Body: { mode: 'seed' | 'empty' } }>(
    '/api/household/reset',
    { schema: { body: { type: 'object', required: ['mode'], properties: { mode: { enum: ['seed', 'empty'] } } } } },
    // Both modes return to first launch: no answers and no rules yet. Gateway devices stay in the home.
    async (req) => {
      ctx.change(req, 'reset', () => (req.body.mode === 'seed' ? ctx.seed() : hh.blankHousehold()), req.body.mode)
      const live = await ctx.live.gatewayDevices().catch(() => [])
      return ctx.change(req, 'reset_live_devices', (h) => live.reduce((acc, d) => hh.addDevice(acc, d.device_id), h))
    },
  )

  app.get('/api/library', async () => ctx.library())

  app.post<{ Body: { payload: string } }>(
    '/api/codes/resolve',
    { schema: { body: { type: 'object', required: ['payload'], properties: { payload: { type: 'string', maxLength: 2048 } } } } },
    async (req) => hh.resolveCode(req.body.payload, ctx.fixtures.codes),
  )

  app.get<{ Params: { id: string } }>('/api/devices/:id', { schema: { params: idParams } }, async (req) => {
    const device = await ctx.device(req.params.id)
    if (!device) throw httpError(404, `Device ${req.params.id} not found.`)
    return device
  })
}
