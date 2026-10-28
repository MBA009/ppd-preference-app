import type { FastifyInstance } from 'fastify'
import * as hh from '../../../shared/household'
import type { Answers, Profile, Rule } from '../../../shared/types'
import { httpError, type AppContext } from '../context'

/** The household: devices in the home, its preset and onboarding answers, and authoring rules. */

const stringList = { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 50 } as const

export const ruleSchema = {
  type: 'object',
  required: ['id', 'effect', 'scope', 'enabled', 'origin'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', maxLength: 500 },
    effect: { enum: ['allow', 'dont_allow'] },
    condition: { anyOf: [{ type: 'null' }, { enum: ['retention=ppd:ephemeral', 'processing_boundary=ppd:inHomeOnly', 'processing_boundary=ppd:onDeviceOnly'] }] },
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: { data_type: stringList, purpose: stringList, handling_context: stringList, action: stringList, source: stringList, constraints: stringList },
    },
    enabled: { type: 'boolean' },
    origin: {
      type: 'object',
      required: ['kind'],
      properties: { kind: { enum: ['preset', 'answer', 'custom'] }, preset_id: { type: 'string', maxLength: 100 }, question: { type: 'string', maxLength: 200 } },
    },
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

const answersSchema = { type: 'object', maxProperties: 50, additionalProperties: { type: 'string', maxLength: 200 } } as const

export function householdRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireDevice = async (id: string) => {
    if (!(await ctx.knownDevice(id))) throw httpError(404, `Device ${id} not found.`)
  }

  app.get('/api/onboarding', async () => ctx.fixtures.onboarding)

  app.get('/api/household-presets', async () => ctx.fixtures.presets)

  app.get('/api/household', async () => ctx.household())

  app.get('/api/household/rules', async () => (await ctx.household()).rules)

  // The questionnaire is finished: the server walks the tree itself (the client only sends answers), assigns the preset
  // and rebuilds the household's rules from it and the answers. Starts over: earlier rules and edits are replaced.
  app.put<{ Body: { answers: Answers } }>(
    '/api/household/onboarding',
    { schema: { body: { type: 'object', required: ['answers'], properties: { answers: answersSchema } } } },
    async (req) => {
      const { onboarding, presets } = ctx.fixtures
      for (const [q, a] of Object.entries(req.body.answers)) {
        const question = onboarding.questions[q]
        if (!question) throw httpError(400, `There is no question ${q}.`)
        if (!question.options.some((o) => o.id === a)) throw httpError(400, `"${a}" is not an answer to ${q}.`)
      }
      let preset = ''
      const h = ctx.change(req, 'finish_onboarding', (h) => {
        try {
          const next = hh.finishOnboarding(h, onboarding, presets, req.body.answers)
          preset = next.preset_id ?? ''
          return next
        } catch (e) {
          throw httpError(400, (e as Error).message)
        }
      })
      await ctx.publisher.sync(`questionnaire finished (${preset})`)
      return h
    },
  )

  app.put<{ Body: Profile }>('/api/household/profile', { schema: { body: { ...profileSchema, required: ['summary_frequency', 'warn_on_conflict'] } } }, async (req) =>
    ctx.change(req, 'save_profile', (h) => hh.saveProfile(h, req.body)),
  )

  app.put<{ Params: { id: string }; Body: Rule }>('/api/household/rules/:id', { schema: { params: idParams, body: ruleSchema } }, async (req) => {
    if (req.body.id !== req.params.id) throw httpError(400, 'The rule id in the body does not match the URL.')
    const h = ctx.change(req, 'upsert_rule', (h) => hh.upsertRule(h, req.body), req.body.id)
    await ctx.publisher.sync('rule saved')
    return h
  })

  app.delete<{ Params: { id: string } }>('/api/household/rules/:id', { schema: { params: idParams } }, async (req) => {
    const h = ctx.change(req, 'delete_rule', (h) => hh.deleteRule(h, req.params.id), req.params.id)
    await ctx.publisher.sync('rule deleted')
    return h
  })

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

  app.post<{ Body: { mode: 'seed' | 'empty' } }>(
    '/api/household/reset',
    { schema: { body: { type: 'object', required: ['mode'], properties: { mode: { enum: ['seed', 'empty'] } } } } },
    // Both modes return to first launch: no preset, answers or rules yet. Gateway devices stay in the home.
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
