import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Policy } from '../../shared/types'
import type { GatewayDevice } from '../src/gateway'

/**
 * A small stand-in for the PPD gateway: -04 metadata, operator routes guarded by a bearer token, and a
 * household policy that PUT replaces. Devices are whatever the test sets in `devices`.
 */
export class FakeGateway {
  devices: GatewayDevice[] = []
  policy: Policy = { policy_id: 'home-default-v4', taxonomy: { release: 'ppd-core-2026-05' }, scope: 'home', rules: [] }
  disassociated: string[] = []
  /** Participant calls seen, as "METHOD path". */
  participantCalls: string[] = []
  puts: Policy[] = []
  readonly token = 'test-operator-token'
  private server = http.createServer((req, res) => this.handle(req, res))
  url = ''

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
    return this
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type })
    res.end(JSON.stringify(body))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', this.url)
    const path = url.pathname
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null

    if (path === '/.well-known/ppd') {
      return this.send(res, 200, { service_base_uri: `http://${req.headers.host}/ppd/v1/`, protocol_version: 'ppd-http-v1', declaration_supported: true, ack_supported: true, security_profile: 'prototype-compatibility' })
    }
    if (path === '/ppd/v1/health') return this.send(res, 200, { status: 'ok' })
    // Participant routes (no operator token): enough of -04 for the simulator's lifecycle.
    if (path.startsWith('/ppd/v1/device/') || path.startsWith('/ppd/v1/policy/effective/')) {
      this.participantCalls.push(`${req.method} ${path}`)
      if (path === '/ppd/v1/device/register') {
        this.devices = this.devices.filter((d) => d.device_id !== body.device_id)
        this.devices.push({ ...body, registered: true, known_to_gateway: true, registered_at: new Date().toISOString(), declared: false, policy_retrieved: false, acknowledged: false, associated: false, association_status: 'not_associated' })
        return this.send(res, 200, { device_id: body.device_id })
      }
      const device = this.devices.find((d) => d.device_id === (body?.device_id ?? decodeURIComponent(path.split('/').pop()!)))
      if (!device) return this.send(res, 404, { title: 'Not found', status: 404 })
      if (path === '/ppd/v1/device/declaration') {
        Object.assign(device, { declared: true, declaration_id: body.declaration_id, declaration_statements: body.statements })
        return this.send(res, 200, { status: 'stored' })
      }
      if (path.startsWith('/ppd/v1/policy/effective/')) {
        device.policy_retrieved = true
        return this.send(res, 200, { policy_id: 'effective-' + device.device_id, policy_hash: 'sha256:1', renewal_interval: 6, rules: [] })
      }
      if (path === '/ppd/v1/device/ack') {
        Object.assign(device, { acknowledged: true, associated: true, association_status: 'associated' })
        return this.send(res, 200, { association_status: 'associated', renewal_interval: 6 })
      }
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      return this.send(res, 401, { type: 'about:blank', title: 'Operator authorization required', status: 401 }, 'application/problem+json')
    }
    if (path === '/ppd/v1/status/devices') return this.send(res, 200, this.devices)
    if (path === '/ppd/v1/status/summary') {
      return this.send(res, 200, { default_policy_id: this.policy.policy_id, default_policy_updated_at: '2026-10-21T00:00:00Z', association_freshness_interval: '15m0s', known_devices: this.devices.length, registered_devices: this.devices.length, associated_devices: this.devices.filter((d) => d.association_status === 'associated').length })
    }
    if (path === '/ppd/v1/service-health/checks') {
      return this.send(res, 200, { checks: [
        { check_id: 'gateway-process', name: 'Gateway HTTP process', category: 'gateway', status: 'pass', detail: 'ok' },
        { check_id: 'repository-health', name: 'Preference repository health', category: 'repository', status: 'pass', detail: 'ok' },
        { check_id: 'dhcp-lease-source', name: 'DHCP lease observation source', category: 'network', status: 'warn', detail: 'no leases' },
      ] })
    }
    if (path === '/ppd/v1/policy/default' && req.method === 'GET') return this.send(res, 200, this.policy)
    if (path === '/ppd/v1/policy/default' && req.method === 'PUT') {
      if (!body?.rules?.every((r: { effect: string }) => r.effect === 'allow' || r.effect === 'deny')) return this.send(res, 400, { title: 'Invalid request', detail: 'effect must be allow or deny', status: 400 }, 'application/problem+json')
      this.puts.push(body)
      this.policy = body
      return this.send(res, 200, { status: 'updated' })
    }
    if (path === '/ppd/v1/policy/examples') return this.send(res, 200, [{ name: 'privacy-tightened-smart-home', title: 'Privacy tightened', summary: 'Denies climate uploads', expected_effects: [], policy_id: 'home-demo-privacy-tightened-v3', rule_count: 4 }])
    if (path.startsWith('/ppd/v1/policy/default/example/')) {
      this.policy = { policy_id: 'home-demo-privacy-tightened-v3', scope: 'home', rules: [] }
      return this.send(res, 200, { status: 'updated' })
    }
    if (path.startsWith('/ppd/v1/device/forget/')) {
      const id = decodeURIComponent(path.split('/').pop()!)
      const d = this.devices.find((x) => x.device_id === id)
      if (!d) return this.send(res, 404, { title: 'Not found', status: 404 })
      if (d.network_observed) return this.send(res, 409, { title: 'device is still on the home network', status: 409 })
      if (d.associated) return this.send(res, 409, { title: 'device is still associated', status: 409 })
      this.devices = this.devices.filter((x) => x !== d)
      return this.send(res, 200, { status: 'forgotten', device_id: id })
    }
    if (path.startsWith('/ppd/v1/device/disassociate/')) {
      this.disassociated.push(decodeURIComponent(path.split('/').pop()!))
      return this.send(res, 200, { status: 'needs_reassociation' })
    }
    return this.send(res, 404, { title: 'Not found', status: 404 })
  }
}

/** A bulb as the gateway reports it after a full association, declaring the core-term bulb statements. */
export function bulb(overrides: Partial<GatewayDevice> = {}): GatewayDevice {
  const st = (statement_id: string, data_type: string, purpose: string, action: string, source: string, handling_context: string, constraints?: Record<string, unknown>) =>
    ({ statement_id, data_type, purpose, action, source, handling_context, ...(constraints ? { constraints } : {}) })
  return {
    device_id: 'superduperlight-bulb-esp32',
    manufacturer: 'SuperDuperLight',
    model: 'SuperDuperLight Bulb A19',
    firmware_version: '0.3.0',
    registered: true,
    registered_at: '2026-10-21T10:00:00Z',
    declared: true,
    declaration_id: 'superduperlight-bulb-capability-v2',
    declared_at: '2026-10-21T10:00:01Z',
    declaration_statements: [
      st('power-control-local', 'ppd:deviceAndNetworkData', 'ppd:coreFunctionality', 'ppd:collection', 'ppd:userProvided', 'ppd:householdContext'),
      st('brightness-control-local', 'ppd:deviceAndNetworkData', 'ppd:coreFunctionality', 'ppd:collection', 'ppd:userProvided', 'ppd:householdContext'),
      st('temperature-remote-monitoring-cloud', 'ppd:sensorData', 'ppd:coreFunctionality', 'ppd:transfer', 'ppd:participantObserved', 'ppd:vendorContext', { retention: 'ppd:indefinite' }),
      st('humidity-remote-monitoring-cloud', 'ppd:sensorData', 'ppd:coreFunctionality', 'ppd:transfer', 'ppd:participantObserved', 'ppd:vendorContext', { retention: 'ppd:indefinite' }),
      st('temperature-analytics-cloud', 'ppd:sensorData', 'ppd:analyticsAndImprovement', 'ppd:transfer', 'ppd:participantObserved', 'ppd:vendorContext', { retention: 'ppd:indefinite' }),
    ],
    policy_retrieved: true,
    acknowledged: true,
    associated: true,
    association_status: 'associated',
    effective_policy_id: 'effective-bulb-1',
    policy_hash: 'sha256:aaa',
    ack_policy_id: 'effective-bulb-1',
    ack_policy_hash: 'sha256:aaa',
    base_policy_id: 'home-default-v4',
    auth_method: 'mtls',
    auth_badge: { label: 'Certificate bound', tone: 'good' },
    last_acknowledged_at: '2026-10-21T10:00:03Z',
    ...overrides,
  }
}
