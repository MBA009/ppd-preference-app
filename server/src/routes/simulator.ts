import type { FastifyInstance } from 'fastify'
import type { SimConsole, SimDevice } from '../../../shared/types'
import { requireOperator, type AppContext } from '../context'
import type { Simulator } from '../simulator'
import { idParams } from './household'

/** The demo simulator's controls. Registered only when app-api runs with SIMULATOR=1; operators only. */
export function simulatorRoutes(app: FastifyInstance, ctx: AppContext, sim: Simulator): void {
  app.get('/api/simulator/devices', async (): Promise<SimDevice[]> => sim.list())

  app.post<{ Params: { id: string } }>('/api/simulator/devices/:id/connect', { schema: { params: idParams } }, async (req) => {
    requireOperator(req)
    ctx.store.audit('sim_connect', req.params.id, req.identity?.email)
    return sim.connect(req.params.id)
  })

  app.post<{ Params: { id: string } }>('/api/simulator/devices/:id/disconnect', { schema: { params: idParams } }, async (req) => {
    requireOperator(req)
    ctx.store.audit('sim_disconnect', req.params.id, req.identity?.email)
    return sim.disconnect(req.params.id)
  })

  app.post<{ Params: { id: string }; Body: { present: boolean } }>(
    '/api/simulator/devices/:id/network',
    { schema: { params: idParams, body: { type: 'object', required: ['present'], properties: { present: { type: 'boolean' } } } } },
    async (req) => {
      requireOperator(req)
      ctx.store.audit(req.body.present ? 'sim_join_network' : 'sim_leave_network', req.params.id, req.identity?.email)
      return sim.network(req.params.id, req.body.present)
    },
  )

  app.get<{ Params: { id: string } }>('/api/simulator/devices/:id/console', { schema: { params: idParams } }, async (req): Promise<SimConsole> => sim.console(req.params.id))

  app.post<{ Params: { id: string }; Body: { action: string } }>(
    '/api/simulator/devices/:id/actions',
    { schema: { params: idParams, body: { type: 'object', required: ['action'], properties: { action: { type: 'string', minLength: 1, maxLength: 40 } } } } },
    async (req) => {
      requireOperator(req)
      return sim.act(req.params.id, req.body.action)
    },
  )

  app.post<{ Params: { id: string }; Body: { mode: SimConsole['behavior'] } }>(
    '/api/simulator/devices/:id/behavior',
    { schema: { params: idParams, body: { type: 'object', required: ['mode'], properties: { mode: { enum: ['follows', 'ignores'] } } } } },
    async (req) => {
      requireOperator(req)
      ctx.store.audit('sim_behavior', `${req.params.id} ${req.body.mode}`, req.identity?.email)
      return sim.setBehavior(req.params.id, req.body.mode)
    },
  )

  app.post<{ Params: { id: string } }>('/api/simulator/devices/:id/log/clear', { schema: { params: idParams } }, async (req) => {
    requireOperator(req)
    return sim.clearLog(req.params.id)
  })

  app.post('/api/simulator/reset', async (req): Promise<SimDevice[]> => {
    requireOperator(req)
    ctx.store.audit('sim_reset', undefined, req.identity?.email)
    return sim.reset()
  })
}
