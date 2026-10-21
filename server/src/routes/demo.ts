import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { isCoreTerm, termLabel } from '../../../shared/taxonomy'
import type { Command, CommandAction, Telemetry, TelemetrySample } from '../../../shared/types'
import { httpError, requireOperator, type AppContext } from '../context'
import { idParams } from './household'

/**
 * Cloud demo extensions (outside the PPD baseline). Devices behind NAT cannot be called, so the app
 * queues allow-listed guided-demo commands that the device polls through the gateway, and the device
 * uploads demo telemetry the same way. The gateway authenticates the device and relays to /internal/*
 * with INTERNAL_SERVICE_TOKEN; app-api trusts the device id only from that relay.
 */

const COMMAND_VALUES: Record<CommandAction, string[] | null> = {
  advance_step: null,
  reassociate: null,
  set_lifecycle_mode: ['guided', 'automatic'],
  set_behavior_mode: ['adaptive', 'fixed_permissive'],
}

function serviceAuthorized(req: FastifyRequest, token: string): boolean {
  const presented = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const a = Buffer.from(presented)
  const b = Buffer.from(token)
  return token.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export function demoRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ---------- for the web app ---------- */

  app.get<{ Params: { id: string } }>('/api/devices/:id/commands', { schema: { params: idParams } }, async (req): Promise<Command[]> => ctx.store.listCommands(req.params.id))

  app.post<{ Params: { id: string }; Body: { action: CommandAction; value?: string } }>(
    '/api/devices/:id/commands',
    {
      schema: {
        params: idParams,
        body: { type: 'object', required: ['action'], properties: { action: { enum: Object.keys(COMMAND_VALUES) }, value: { type: 'string', maxLength: 40 } } },
      },
    },
    async (req): Promise<Command> => {
      requireOperator(req)
      const allowed = COMMAND_VALUES[req.body.action]
      const value = req.body.value ?? null
      if (allowed ? !value || !allowed.includes(value) : value) throw httpError(400, `Value ${value ?? '(none)'} is not valid for ${req.body.action}.`)
      const known = (await ctx.live.gatewayDevices().catch(() => [])).some((d) => d.device_id === req.params.id)
      if (!known) throw httpError(404, 'Only devices connected to the gateway can receive commands.')
      return ctx.store.createCommand(req.params.id, req.body.action, value, req.identity?.email ?? 'unknown')
    },
  )

  app.get<{ Params: { id: string } }>('/api/devices/:id/telemetry', { schema: { params: idParams } }, async (req): Promise<Telemetry> => ({
    samples: ctx.store.telemetry(req.params.id),
    by_purpose: ctx.store.telemetryByPurpose(req.params.id).map((p) => ({ ...p, label: termLabel('purpose', p.purpose) })),
  }))

  /* ---------- for the gateway relay ---------- */

  app.register(async (internal) => {
    internal.addHook('onRequest', async (req) => {
      if (!ctx.config.internalServiceToken) throw httpError(404, 'Demo callbacks are not enabled.')
      if (!serviceAuthorized(req, ctx.config.internalServiceToken)) throw httpError(401, 'Service token required.')
    })
    const deviceHeader = (req: FastifyRequest) => String(req.headers['x-ppd-device-id'] ?? '')

    internal.post<{ Body: Omit<TelemetrySample, 'received_at'> & { device_id: string } }>(
      '/internal/telemetry',
      {
        schema: {
          body: {
            type: 'object',
            required: ['device_id', 'sample_id', 'purpose'],
            properties: {
              device_id: { type: 'string', maxLength: 200 },
              sample_id: { type: 'string', minLength: 1, maxLength: 200 },
              purpose: { type: 'string', maxLength: 100 },
              temperature_c: { type: ['number', 'null'], minimum: -60, maximum: 100 },
              humidity_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
              reported_policy_id: { type: ['string', 'null'], maxLength: 200 },
              behavior_mode: { type: ['string', 'null'], maxLength: 40 },
            },
          },
        },
      },
      async (req) => {
        // The gateway authenticated this device; a body claiming another device is rejected.
        if (req.body.device_id !== deviceHeader(req)) throw httpError(403, 'The sample is for a different device than the authenticated one.')
        if (!isCoreTerm('purpose', req.body.purpose)) throw httpError(422, 'purpose must be a core ppd: purpose term.')
        const stored = ctx.store.addTelemetry(req.body.device_id, {
          sample_id: req.body.sample_id,
          purpose: req.body.purpose,
          temperature_c: req.body.temperature_c ?? null,
          humidity_pct: req.body.humidity_pct ?? null,
          reported_policy_id: req.body.reported_policy_id ?? null,
          behavior_mode: req.body.behavior_mode ?? null,
        })
        return { status: stored ? 'stored' : 'duplicate' }
      },
    )

    internal.get<{ Params: { id: string } }>('/internal/devices/:id/commands/pending', { schema: { params: idParams } }, async (req) => {
      if (req.params.id !== deviceHeader(req)) throw httpError(403, 'Commands are only served to the device they target.')
      return { commands: ctx.store.pendingCommands(req.params.id).map((c) => ({ id: c.id, action: c.action, value: c.value ?? '' })) }
    })

    internal.post<{ Params: { id: string; cid: string }; Body: { status: 'completed' | 'skipped' | 'failed'; detail?: string } }>(
      '/internal/devices/:id/commands/:cid/result',
      {
        schema: {
          params: { type: 'object', required: ['id', 'cid'], properties: { id: { type: 'string', maxLength: 200 }, cid: { type: 'string', maxLength: 64 } } },
          body: { type: 'object', required: ['status'], properties: { status: { enum: ['completed', 'skipped', 'failed'] }, detail: { type: 'string', maxLength: 300 } } },
        },
      },
      async (req) => {
        if (req.params.id !== deviceHeader(req)) throw httpError(403, 'Results are only accepted from the device the command targeted.')
        if (!ctx.store.commandResult(req.params.id, req.params.cid, req.body.status, req.body.detail ?? '')) throw httpError(404, 'Unknown command.')
        return { status: 'recorded' }
      },
    )
  })
}
