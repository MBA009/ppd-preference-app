import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import type { FastifyInstance } from 'fastify'
import type { DeviceSummary, Household, Overview, SimDevice, UnmanagedDevice } from '../../shared/types'
import { buildApp } from '../src/app'
import { loadConfig, type Config } from '../src/config'
import { loadFixtures } from '../src/fixtures'
import { HouseholdStore } from '../src/store'
import { FakeGateway, bulb } from './fakeGateway'

const gateway = await new FakeGateway().start()
const dir = mkdtempSync(path.join(tmpdir(), 'ppd-sim-'))
const base = loadConfig({})
const config: Config = {
  ...base,
  databasePath: path.join(dir, 'app.db'),
  logLevel: 'silent',
  gateway: { ...base.gateway, url: gateway.url, operatorToken: gateway.token },
  simulator: { enabled: true, gatewayUrl: gateway.url, leasesFile: path.join(dir, 'dhcp.leases'), certDir: '', caFile: '' },
}

let app: FastifyInstance
let store: HouseholdStore
const start = async () => {
  store = new HouseholdStore(config.databasePath)
  app = buildApp(config, await loadFixtures(config.fixturesDir), store)
  await app.ready()
}
const stop = async () => {
  await app.close()
  store.close()
}

before(start)
after(async () => {
  await stop()
  await gateway.stop()
})

const json = async <T>(method: 'GET' | 'POST', url: string, payload?: object, status = 200): Promise<T> => {
  const res = await app.inject({ method, url, payload, headers: { 'x-ppd-client': 'web' } })
  assert.equal(res.statusCode, status, `${method} ${url}: ${res.body}`)
  return res.json() as T
}
const until = async (check: () => Promise<boolean>, ms = 4000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  assert.fail('condition not reached in time')
}
const leases = () => readFileSync(config.simulator.leasesFile, 'utf8')

describe('network view and CableLabs cards', () => {
  test('unmanaged devices are listed with a research match and never join the household', async () => {
    gateway.devices = [
      bulb(),
      { device_id: 'network-0250500000ff', registered: false, known_to_gateway: false, network_observed: true, hostname: 'LG-Living-Room', ip_address: '192.0.2.99', mac_address: '02:50:50:00:00:ff', declared: false, policy_retrieved: false, acknowledged: false, associated: false, association_status: '' },
    ]
    const network = await json<UnmanagedDevice[]>('GET', '/api/network')
    assert.equal(network.length, 1)
    assert.equal(network[0].research_match?.id, 'lg-oled65c6pua-c6')
    assert.equal(network[0].simulated, false)
    const h = await json<Household>('GET', '/api/household')
    assert.ok(!h.devices.some((d) => d.device_id.startsWith('network-')))
  })

  test('overview carries the four CableLabs counts', async () => {
    const o = await json<Overview>('GET', '/api/overview')
    // Known counts the bulb and the network-only device; only the bulb is associated.
    assert.equal(o.counts.known, 2)
    assert.equal(o.counts.associated, 1)
    assert.equal(o.counts.need_attention, 1)
    assert.equal(typeof o.counts.unmanaged, 'number')
  })

  test('forget refuses a device that is associated or on the network, then removes it everywhere', async () => {
    gateway.devices = [bulb(), bulb({ device_id: 'old-lamp', associated: false, association_status: 'stale_association', network_observed: false })]
    await json<Household>('GET', '/api/household')
    const refused = await app.inject({ method: 'POST', url: '/api/devices/superduperlight-bulb-esp32/forget', headers: { 'x-ppd-client': 'web' } })
    assert.equal(refused.statusCode, 409)
    gateway.devices[0].network_observed = true
    gateway.devices[0].associated = false
    const present = await app.inject({ method: 'POST', url: '/api/devices/superduperlight-bulb-esp32/forget', headers: { 'x-ppd-client': 'web' } })
    assert.equal(present.statusCode, 409)
    assert.match(present.json().message, /home network/)

    const h = await json<Household>('POST', '/api/devices/old-lamp/forget')
    assert.ok(!h.devices.some((d) => d.device_id === 'old-lamp'))
    assert.ok(!gateway.devices.some((d) => d.device_id === 'old-lamp'))
  })

  test('/api/me says the simulator is on', async () => {
    assert.equal((await json<{ simulator: boolean }>('GET', '/api/me')).simulator, true)
  })
})

describe('simulator', () => {
  test('lists the four demo devices, all off', async () => {
    gateway.devices = []
    const list = await json<SimDevice[]>('GET', '/api/simulator/devices')
    assert.deepEqual(list.map((d) => [d.id, d.mode, d.state]), [
      ['aqara-w200-01', 'ppd', 'off'],
      ['reolink-e1-zoom-01', 'ppd', 'off'],
      ['level-lock-01', 'ppd', 'off'],
      ['lg-oled65c6pua-c6-01', 'network', 'off'],
    ])
  })

  test('connect joins the network and runs the full PPD lifecycle through the gateway', async () => {
    gateway.participantCalls = []
    await json<SimDevice>('POST', '/api/simulator/devices/level-lock-01/connect')
    assert.match(leases(), /02:50:50:00:00:03 192\.0\.2\.33 level-lock \*/)
    await until(async () => (await json<SimDevice[]>('GET', '/api/simulator/devices')).find((d) => d.id === 'level-lock-01')!.state === 'associated')
    assert.deepEqual(gateway.participantCalls.slice(0, 4), [
      'POST /ppd/v1/device/register',
      'POST /ppd/v1/device/declaration',
      'GET /ppd/v1/policy/effective/level-lock-01',
      'POST /ppd/v1/device/ack',
    ])
    // Declared from the research fixture, in core terms only.
    const declared = gateway.devices.find((d) => d.device_id === 'level-lock-01')!
    assert.ok(declared.declaration_statements!.length > 10)
    assert.ok(declared.declaration_statements!.every((s) => s.data_type.startsWith('ppd:') && s.purpose.startsWith('ppd:')))
    // The app learns about it from the gateway: it joins the home, and the research entry is no longer listed twice.
    const h = await json<Household>('GET', '/api/household')
    assert.equal(h.devices.find((d) => d.device_id === 'level-lock-01')?.joined_seen, false)
    const lib = await json<DeviceSummary[]>('GET', '/api/library')
    assert.ok(lib.some((d) => d.id === 'level-lock-01' && d.kind === 'simulated'))
    assert.ok(!lib.some((d) => d.id === 'level-lock'))
  })

  test('disconnect stops renewing and leaves the network', async () => {
    const d = await json<SimDevice>('POST', '/api/simulator/devices/level-lock-01/disconnect')
    assert.equal(d.state, 'paused')
    const calls = gateway.participantCalls.length
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(gateway.participantCalls.length, calls)
    assert.doesNotMatch(leases(), /level-lock/)
  })

  test('network-only devices join and leave the network, and use the right button', async () => {
    await json<SimDevice>('POST', '/api/simulator/devices/lg-oled65c6pua-c6-01/connect', undefined, 400)
    const on = await json<SimDevice>('POST', '/api/simulator/devices/lg-oled65c6pua-c6-01/network', { present: true })
    assert.equal(on.state, 'on_network')
    assert.match(leases(), /LG-OLED65C6/)
    await json<SimDevice>('POST', '/api/simulator/devices/lg-oled65c6pua-c6-01/network', { present: false })
    assert.doesNotMatch(leases(), /LG-OLED65C6/)
  })

  test('wanted state survives a restart', async () => {
    await json<SimDevice>('POST', '/api/simulator/devices/aqara-w200-01/connect')
    await stop()
    await start()
    const aqara = (await json<SimDevice[]>('GET', '/api/simulator/devices')).find((d) => d.id === 'aqara-w200-01')!
    assert.equal(aqara.wanted, 'connected')
    await until(async () => (await json<SimDevice[]>('GET', '/api/simulator/devices')).find((d) => d.id === 'aqara-w200-01')!.state === 'associated')
  })

  test('reset turns everything off and clears the leases', async () => {
    const list = await json<SimDevice[]>('POST', '/api/simulator/reset')
    assert.ok(list.every((d) => d.state === 'off' && d.wanted === 'off'))
    assert.equal(leases(), '')
  })
})
