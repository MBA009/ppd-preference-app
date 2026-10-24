import type { FastifyInstance } from 'fastify'
import type { SimDevice } from '../../../shared/types'
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

  app.post('/api/simulator/reset', async (req): Promise<SimDevice[]> => {
    requireOperator(req)
    ctx.store.audit('sim_reset', undefined, req.identity?.email)
    return sim.reset()
  })
}
