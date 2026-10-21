import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { Device, Household, Rule } from '../../shared/types'
import { buildApp } from '../src/app'
import { loadConfig } from '../src/config'
import { loadFixtures } from '../src/fixtures'
import { HouseholdStore } from '../src/store'

// Unreachable gateway on purpose: app-api must keep serving the household without it.
const config = { ...loadConfig({}), databasePath: ':memory:', gatewayUrl: 'http://127.0.0.1:9', logLevel: 'silent' }

let app: FastifyInstance
let store: HouseholdStore

before(async () => {
  store = new HouseholdStore(config.databasePath)
  app = buildApp(config, await loadFixtures(config.fixturesDir), store)
  await app.ready()
})
after(async () => {
  await app.close()
  store.close()
})

const json = async <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, status = 200): Promise<T> => {
  const res = await app.inject({ method, url, payload })
  assert.equal(res.statusCode, status, `${method} ${url}: ${res.body}`)
  assert.equal(res.headers['cache-control'], 'no-store')
  return res.json() as T
}

const neverRule: Rule = {
  id: 'r-test',
  title: 'No content to the maker',
  effect: 'dont_allow',
  scope: { data_type: ['ppd:contentData'], handling_context: ['ppd:vendorContext'] },
  enabled: true,
  origin: { kind: 'custom' },
}

describe('app-api', () => {
  test('health reports the database and an unreachable gateway', async () => {
    const h = await json<{ status: string; database: boolean; gateway: { reachable: boolean } }>('GET', '/api/health')
    assert.equal(h.status, 'ok')
    assert.equal(h.database, true)
    assert.equal(h.gateway.reachable, false)
  })

  test('first read returns the seeded household at first launch', async () => {
    const h = await json<Household>('GET', '/api/household')
    assert.equal(h.answers, null)
    assert.ok(h.devices.length > 0)
  })

  test('questionnaire and library come from the fixtures', async () => {
    const q = await json<{ questions: unknown[] }>('GET', '/api/questionnaire')
    assert.ok(q.questions.length > 0)
    const lib = await json<{ id: string }[]>('GET', '/api/library')
    assert.deepEqual(lib.map((d) => d.id).sort(), ['aqara-w200', 'level-lock', 'lg-oled65c6pua-c6', 'reolink-e1-zoom'])
  })

  test('saving a rule changes the verdicts computed for a device', async () => {
    const before = await json<Device>('GET', '/api/devices/reolink-e1-zoom')
    const upload = before.flows.find((f) => f.title === 'Cloud video upload')!
    assert.notEqual(upload.evaluation.verdict, 'unsatisfiable')

    const h = await json<Household>('PUT', '/api/household/rules/r-test', neverRule)
    assert.ok(h.rules.some((r) => r.id === 'r-test'))

    const afterRule = await json<Device>('GET', '/api/devices/reolink-e1-zoom')
    const evaluated = afterRule.flows.find((f) => f.title === 'Cloud video upload')!.evaluation
    assert.equal(evaluated.verdict, 'unsatisfiable')
    assert.equal(evaluated.rule_id, 'r-test')

    await json<Household>('DELETE', '/api/household/rules/r-test')
  })

  test('policy save stores answers, rules and profile', async () => {
    const h = await json<Household>('PUT', '/api/household/policy', {
      answers: { q1: 'a' },
      rules: [neverRule],
      profile: { summary_frequency: 'monthly', warn_on_conflict: true },
    })
    assert.deepEqual(h.answers, { q1: 'a' })
    assert.equal((await json<Rule[]>('GET', '/api/household/rules')).length, 1)
  })

  test('device membership, saved list and decisions', async () => {
    await json<Household>('POST', '/api/household/reset', { mode: 'empty' })
    let h = await json<Household>('POST', '/api/household/saved', { device_id: 'level-lock' })
    assert.deepEqual(h.saved, ['level-lock'])
    h = await json<Household>('POST', '/api/household/devices', { device_id: 'level-lock', joined: true })
    assert.deepEqual(h.saved, [])
    assert.equal(h.devices[0].joined_seen, false)
    h = await json<Household>('POST', '/api/household/devices/level-lock/seen')
    assert.equal(h.devices[0].joined_seen, true)

    const flow = (await json<Device>('GET', '/api/devices/level-lock')).flows[0]
    h = await json<Household>('POST', '/api/household/decisions', {
      flow_id: flow.id,
      device_id: 'level-lock',
      preference: 'dont_allow',
      remember_similar: true,
      core_group_id: flow.core_group.id,
    })
    assert.equal(h.decisions[flow.id].preference, 'dont_allow')
    assert.ok(h.group_decisions[flow.core_group.id])

    h = await json<Household>('DELETE', '/api/household/devices/level-lock')
    assert.equal(h.devices.length, 0)
    assert.deepEqual(h.decisions, {})
  })

  test('privacy codes resolve to devices and Matter codes are refused', async () => {
    const code = await json<{ ok: boolean; device_id?: string }>('POST', '/api/codes/resolve', { payload: 'https://ppd.example/d/aqara-w200-01' })
    assert.deepEqual(code, { ok: true, device_id: 'aqara-w200' })
    const matter = await json<{ ok: boolean; reason?: string }>('POST', '/api/codes/resolve', { payload: 'MT:Y.K9042C00KA0648G00' })
    assert.deepEqual(matter, { ok: false, reason: 'matter_code' })
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

  test('changes survive in the store and bump the revision', async () => {
    const r1 = store.revision()
    await json<Household>('POST', '/api/household/saved', { device_id: 'aqara-w200' })
    assert.equal(store.revision(), r1 + 1)
    assert.ok(store.get()!.saved.includes('aqara-w200'))
  })
})
