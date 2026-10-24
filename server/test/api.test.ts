import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { Device, Household, Policy, PublishPreview, Rule } from '../../shared/types'
import { buildApp } from '../src/app'
import { Authenticator } from '../src/auth'
import { loadConfig, type Config } from '../src/config'
import { loadFixtures } from '../src/fixtures'
import { HouseholdStore } from '../src/store'
import { FakeGateway, bulb } from './fakeGateway'

const gateway = await new FakeGateway().start()
const baseConfig = loadConfig({})
const config: Config = {
  ...baseConfig,
  databasePath: ':memory:',
  logLevel: 'silent',
  internalServiceToken: 'test-service-token',
  gateway: { ...baseConfig.gateway, url: gateway.url, operatorToken: gateway.token },
}

let app: FastifyInstance
let store: HouseholdStore

const reset = async () => {
  store = new HouseholdStore(':memory:')
  app = buildApp(config, await loadFixtures(config.fixturesDir), store)
  await app.ready()
}

before(reset)
after(async () => {
  await app.close()
  store.close()
  await gateway.stop()
})

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
const json = async <T>(method: Method, url: string, payload?: object, status = 200, headers: Record<string, string> = {}): Promise<T> => {
  const res = await app.inject({ method, url, payload, headers: { 'x-ppd-client': 'web', ...headers } })
  assert.equal(res.statusCode, status, `${method} ${url}: ${res.body}`)
  assert.equal(res.headers['cache-control'], 'no-store')
  return (res.body ? res.json() : null) as T
}

const rule = (id: string, effect: Rule['effect'], scope: Rule['scope']): Rule => ({ id, title: id, effect, scope, enabled: true, origin: { kind: 'custom' } })
const neverRule = rule('r-test', 'dont_allow', { data_type: ['ppd:contentData'], handling_context: ['ppd:vendorContext'] })

describe('household (fixtures)', () => {
  test('health reports the database and the gateway', async () => {
    const h = await json<{ status: string; database: boolean; gateway: { reachable: boolean } }>('GET', '/api/health')
    assert.equal(h.status, 'ok')
    assert.equal(h.database, true)
    assert.equal(h.gateway.reachable, true)
  })

  test('first read returns the seeded household at first launch', async () => {
    const h = await json<Household>('GET', '/api/household')
    assert.equal(h.answers, null)
    // Every researched fixture has a simulated stand-in, so first launch starts with no research devices:
    // devices join from the gateway, or are added from the library.
    assert.deepEqual(h.devices.map((d) => d.device_id), [])
  })

  test('fixture flows use only core terms and object constraints', async () => {
    const d = await json<Device>('GET', '/api/devices/reolink-e1-zoom')
    for (const f of d.flows) {
      for (const field of ['data_type', 'purpose', 'action', 'source', 'handling_context'] as const) assert.match(f.taxonomy[field], /^ppd:/)
      assert.equal(typeof f.taxonomy.constraints, 'object')
      assert.ok(!Array.isArray(f.taxonomy.constraints))
    }
  })

  test('saving a rule changes the verdicts computed for a device', async () => {
    const upload = (await json<Device>('GET', '/api/devices/reolink-e1-zoom')).flows.find((f) => f.title === 'Cloud video upload')!
    assert.notEqual(upload.evaluation.verdict, 'unsatisfiable')
    await json<Household>('PUT', '/api/household/rules/r-test', neverRule)
    const evaluated = (await json<Device>('GET', '/api/devices/reolink-e1-zoom')).flows.find((f) => f.title === 'Cloud video upload')!.evaluation
    assert.equal(evaluated.verdict, 'unsatisfiable')
    assert.equal(evaluated.rule_id, 'r-test')
    await json<Household>('DELETE', '/api/household/rules/r-test')
  })

  test('rules can be scoped by source', async () => {
    await json<Household>('PUT', '/api/household/rules/r-src', rule('r-src', 'dont_allow', { source: ['ppd:userProvided'], handling_context: ['ppd:vendorContext'] }))
    const d = await json<Device>('GET', '/api/devices/aqara-w200')
    const hit = d.flows.filter((f) => f.evaluation.rule_id === 'r-src')
    assert.ok(hit.length > 0 && hit.every((f) => f.taxonomy.source === 'ppd:userProvided'))
    await json<Household>('DELETE', '/api/household/rules/r-src')
  })

  test('device membership, saved list and decisions', async () => {
    await json<Household>('POST', '/api/household/reset', { mode: 'empty' })
    let h = await json<Household>('POST', '/api/household/saved', { device_id: 'level-lock' })
    assert.deepEqual(h.saved, ['level-lock'])
    h = await json<Household>('POST', '/api/household/devices', { device_id: 'level-lock', joined: true })
    assert.deepEqual(h.saved, [])
    h = await json<Household>('POST', '/api/household/devices/level-lock/seen')
    assert.equal(h.devices.find((d) => d.device_id === 'level-lock')!.joined_seen, true)
    const flow = (await json<Device>('GET', '/api/devices/level-lock')).flows[0]
    h = await json<Household>('POST', '/api/household/decisions', { flow_id: flow.id, device_id: 'level-lock', preference: 'dont_allow', remember_similar: true, core_group_id: flow.core_group.id })
    assert.equal(h.decisions[flow.id].preference, 'dont_allow')
    h = await json<Household>('DELETE', '/api/household/devices/level-lock')
    assert.deepEqual(h.decisions, {})
  })

  test('privacy codes resolve to devices and Matter codes are refused', async () => {
    assert.deepEqual(await json('POST', '/api/codes/resolve', { payload: 'https://ppd.example/d/aqara-w200-01' }), { ok: true, device_id: 'aqara-w200' })
    assert.deepEqual(await json('POST', '/api/codes/resolve', { payload: 'MT:Y.K9042C00KA0648G00' }), { ok: false, reason: 'matter_code' })
  })

  test('bad input is rejected with a readable message', async () => {
    await json('GET', '/api/devices/not-a-device', undefined, 404)
    await json('POST', '/api/household/devices', { device_id: 'not-a-device' }, 404)
    await json('PUT', '/api/household/rules/r-test', { ...neverRule, effect: 'maybe' }, 400)
    await json('PUT', '/api/household/rules/other-id', neverRule, 400)
    await json('POST', '/api/household/reset', { mode: 'everything' }, 400)
    const res = await json<{ message: string }>('GET', '/api/nope', undefined, 404)
    assert.match(res.message, /No such API route/)
  })

  test('writes without the app header are refused (CSRF)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/household/saved', payload: { device_id: 'aqara-w200' } })
    assert.equal(res.statusCode, 403)
  })
})

describe('gateway devices', () => {
  beforeEach(async () => {
    gateway.devices = [bulb()]
    gateway.policy = { policy_id: 'home-default-v4', taxonomy: { release: 'ppd-core-2026-05' }, scope: 'home', rules: [] }
    gateway.puts = []
    await reset()
  })

  test('a registered device joins the home and shows its live state', async () => {
    const h = await json<Household>('GET', '/api/household')
    const entry = h.devices.find((d) => d.device_id === 'superduperlight-bulb-esp32')
    assert.ok(entry && entry.joined_seen === false)
    const d = await json<Device>('GET', '/api/devices/superduperlight-bulb-esp32')
    assert.equal(d.kind, 'real')
    assert.equal(d.short_name, 'SuperDuperLight Bulb')
    assert.equal(d.flows.length, 5)
    assert.equal(d.flows.find((f) => f.id.endsWith('.power-control-local'))!.title, 'Turning the bulb on and off')
    assert.equal(d.live?.association.status, 'associated')
    assert.equal(d.live?.receipt?.current, true)
    assert.equal(d.live?.identity.certificate_bound, true)
    assert.equal(d.declaration?.state, 'rules_confirmed')
  })

  test('the library lists gateway devices first', async () => {
    const lib = await json<{ id: string; kind: string }[]>('GET', '/api/library')
    assert.equal(lib[0].id, 'superduperlight-bulb-esp32')
    assert.equal(lib[0].kind, 'real')
    assert.ok(lib.some((d) => d.id === 'level-lock' && d.kind === 'research'))
  })

  test('overview and system status come from the gateway; router checks are hidden', async () => {
    const o = await json<{ gateway: { reachable: boolean }; counts: { known: number; associated: number }; household_policy: { policy_id: string } }>('GET', '/api/overview')
    assert.equal(o.gateway.reachable, true)
    assert.equal(o.counts.known, 1)
    assert.equal(o.household_policy.policy_id, 'home-default-v4')
    const s = await json<{ checks: { id: string; group: string }[] }>('GET', '/api/system-status')
    assert.ok(s.checks.some((c) => c.id === 'repository-health' && c.group === 'repository'))
    assert.ok(!s.checks.some((c) => c.id === 'dhcp-lease-source'))
  })

  test('preview compiles one atomic rule per declared dataflow and waits on undecided flows', async () => {
    const preview = await json<PublishPreview>('GET', '/api/household/preview')
    assert.equal(preview.devices, 1)
    // Power and brightness share one dataflow; the in-home rule is allowed by default.
    const home = preview.rules.find((r) => r.data_type === 'ppd:deviceAndNetworkData')!
    assert.equal(home.effect, 'allow')
    assert.equal(home.flows.length, 2)
    // Nothing covers the two cloud dataflows yet, so they wait for a decision.
    assert.equal(preview.blocked.length, 3)
    await json('POST', '/api/household/publish', {}, 409)
  })

  test('publishing sends a -04 policy, reads it back, and records it', async () => {
    await json<Household>('PUT', '/api/household/rules/allow-monitoring', rule('allow-monitoring', 'allow', { data_type: ['ppd:sensorData'], purpose: ['ppd:coreFunctionality'] }))
    await json<Household>('PUT', '/api/household/rules/no-analytics', rule('no-analytics', 'dont_allow', { purpose: ['ppd:analyticsAndImprovement'] }))
    const result = await json<{ policy_id: string; rules: number }>('POST', '/api/household/publish', {})
    assert.match(result.policy_id, /^household-\d{8}-\d{6}Z$/)
    assert.equal(result.rules, 3)
    const sent = gateway.puts.at(-1)!
    assert.deepEqual(sent.taxonomy, { release: 'ppd-core-2026-05' })
    assert.ok(sent.rules.every((r) => r.effect === 'allow' || r.effect === 'deny'))
    const analytics = sent.rules.find((r) => r.purpose === 'ppd:analyticsAndImprovement')!
    assert.equal(analytics.effect, 'deny')
    assert.deepEqual(analytics.constraints, { retention: 'ppd:indefinite' })
    const overview = await json<{ household_policy: { published_by_app: boolean } }>('GET', '/api/overview')
    assert.equal(overview.household_policy.published_by_app, true)
    // The device has not picked up the new instance yet.
    assert.equal((await json<Device>('GET', '/api/devices/superduperlight-bulb-esp32')).live?.publication, 'waiting')
  })

  test('a saved decision resolves an undecided flow, and "allow with limits" adds limits', async () => {
    await json<Household>('PUT', '/api/household/rules/no-analytics', rule('no-analytics', 'dont_allow', { purpose: ['ppd:analyticsAndImprovement'] }))
    const d = await json<Device>('GET', '/api/devices/superduperlight-bulb-esp32')
    const monitoring = d.flows.find((f) => f.id.endsWith('temperature-remote-monitoring-cloud'))!
    await json<Household>('POST', '/api/household/decisions', { flow_id: monitoring.id, device_id: d.id, preference: 'allow_with_limits', keep: 'briefly', region: 'United States', remember_similar: true, core_group_id: monitoring.core_group.id })
    const preview = await json<PublishPreview>('GET', '/api/household/preview')
    assert.equal(preview.blocked.length, 0)
    const r = preview.rules.find((x) => x.purpose === 'ppd:coreFunctionality' && x.data_type === 'ppd:sensorData')!
    assert.equal(r.effect, 'allow')
    assert.deepEqual(r.constraints, { retention: 'ppd:ephemeral', jurisdiction: { scope: 'storage', countrycode: ['us'] } })
  })

  test('presets and disassociation go through the gateway', async () => {
    const presets = await json<{ name: string }[]>('GET', '/api/presets')
    assert.equal(presets[0].name, 'privacy-tightened-smart-home')
    const p = await json<Policy>('POST', '/api/presets/privacy-tightened-smart-home/apply', {})
    assert.equal(p.policy_id, 'home-demo-privacy-tightened-v3')
    await json('POST', '/api/devices/superduperlight-bulb-esp32/disassociate', {}, 204)
    assert.deepEqual(gateway.disassociated, ['superduperlight-bulb-esp32'])
  })

  test('guided commands are queued for the app and served to the authenticated device once', async () => {
    const cmd = await json<{ id: string; status: string }>('POST', '/api/devices/superduperlight-bulb-esp32/commands', { action: 'set_behavior_mode', value: 'fixed_permissive' })
    assert.equal(cmd.status, 'queued')
    await json('POST', '/api/devices/superduperlight-bulb-esp32/commands', { action: 'set_behavior_mode', value: 'chaos' }, 400)
    await json('POST', '/api/devices/level-lock/commands', { action: 'advance_step' }, 404)

    const svc = { authorization: 'Bearer test-service-token', 'x-ppd-device-id': 'superduperlight-bulb-esp32' }
    await json('GET', '/internal/devices/superduperlight-bulb-esp32/commands/pending', undefined, 401)
    await json('GET', '/internal/devices/superduperlight-bulb-esp32/commands/pending', undefined, 403, { ...svc, 'x-ppd-device-id': 'someone-else' })
    const pending = await json<{ commands: { id: string; action: string; value: string }[] }>('GET', '/internal/devices/superduperlight-bulb-esp32/commands/pending', undefined, 200, svc)
    assert.deepEqual(pending.commands, [{ id: cmd.id, action: 'set_behavior_mode', value: 'fixed_permissive' }])
    await json('POST', `/internal/devices/superduperlight-bulb-esp32/commands/${cmd.id}/result`, { status: 'completed', detail: 'Behavior mode is fixed_permissive' }, 200, svc)
    const again = await json<{ commands: unknown[] }>('GET', '/internal/devices/superduperlight-bulb-esp32/commands/pending', undefined, 200, svc)
    assert.equal(again.commands.length, 0)
    const listed = await json<{ status: string }[]>('GET', '/api/devices/superduperlight-bulb-esp32/commands')
    assert.equal(listed[0].status, 'completed')
  })

  test('telemetry is stored once per sample and only for the authenticated device', async () => {
    const svc = { authorization: 'Bearer test-service-token', 'x-ppd-device-id': 'superduperlight-bulb-esp32' }
    const sample = { device_id: 'superduperlight-bulb-esp32', sample_id: 's1', purpose: 'ppd:coreFunctionality', temperature_c: 21.5, humidity_pct: 40 }
    assert.deepEqual(await json('POST', '/internal/telemetry', sample, 200, svc), { status: 'stored' })
    assert.deepEqual(await json('POST', '/internal/telemetry', sample, 200, svc), { status: 'duplicate' })
    await json('POST', '/internal/telemetry', { ...sample, sample_id: 's2', purpose: 'remoteMonitoring' }, 422, svc)
    await json('POST', '/internal/telemetry', { ...sample, sample_id: 's3', device_id: 'other' }, 403, svc)
    const t = await json<{ samples: unknown[]; by_purpose: { purpose: string; count: number; label: string }[] }>('GET', '/api/devices/superduperlight-bulb-esp32/telemetry')
    assert.equal(t.samples.length, 1)
    assert.deepEqual(t.by_purpose.map((p) => [p.purpose, p.count, p.label]), [['ppd:coreFunctionality', 1, 'Making a feature work']])
  })
})

describe('sign-in', () => {
  test('production requires a valid Cloudflare Access token', async () => {
    const prod: Config = { ...config, appEnv: 'production', auth: { teamDomain: 'team.example', audience: 'aud-1', operatorEmails: [] } }
    const auth = new Authenticator(prod)
    const prodApp = buildApp(prod, await loadFixtures(prod.fixturesDir), new HouseholdStore(':memory:'), { auth })
    assert.equal((await prodApp.inject({ method: 'GET', url: '/api/household' })).statusCode, 401)
    assert.equal((await prodApp.inject({ method: 'GET', url: '/api/household', headers: { 'cf-access-jwt-assertion': 'not.a.jwt' } })).statusCode, 401)
    assert.equal((await prodApp.inject({ method: 'GET', url: '/api/health' })).statusCode, 200)
    await prodApp.close()
  })

  test('viewers cannot publish or drive devices', async () => {
    const viewer = { identify: async () => ({ email: 'guest@example.com', role: 'viewer' as const }) } as unknown as Authenticator
    const viewApp = buildApp(config, await loadFixtures(config.fixturesDir), new HouseholdStore(':memory:'), { auth: viewer })
    const res = await viewApp.inject({ method: 'POST', url: '/api/household/publish', headers: { 'x-ppd-client': 'web' } })
    assert.equal(res.statusCode, 403)
    assert.equal((await viewApp.inject({ method: 'GET', url: '/api/household' })).statusCode, 200)
    await viewApp.close()
  })
})
