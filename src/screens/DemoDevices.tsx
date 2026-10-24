import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type SimDevice } from '../api'
import { AppBar, Cell, DeviceTile, ErrorBox, Footnote, Group, Loading, SectionHeader } from '../components/ui'
import { useDevices, useHousehold, useMe, useSimDevices } from '../state/data'
import { DemoControls, TelemetryCard } from '../components/LiveDevice'
import { timeAgo } from '../lib/device'

/**
 * The presenter's control page: the demo simulator (app-api with SIMULATOR=1), whose devices join the home
 * gateway exactly like real hardware, and the real ESP32 bulb's uploads and remote controls. None of the latter
 * is PPD: it plays the device maker's side, so the audience can see the bulb change what it sends when the
 * household's rules change. Meant for the presenter's laptop while the audience watches My home.
 */

const STATE: Record<SimDevice['state'], { label: string; cls: string }> = {
  off: { label: 'Off', cls: 'unk' },
  joining: { label: 'Joining', cls: 'dec' },
  associated: { label: 'Has your rules', cls: 'ok' },
  paused: { label: 'Unplugged', cls: 'unk' },
  on_network: { label: 'On the network', cls: 'lim' },
  error: { label: 'Can’t reach gateway', cls: 'bad' },
}

export default function DemoDevices() {
  const { data: me } = useMe()
  const simulator = !!me?.simulator
  const sims = useSimDevices()
  const { household, toast } = useHousehold()
  const { data: devices } = useDevices(household?.devices.map((d) => d.device_id) ?? [], true)
  const [busy, setBusy] = useState<string | null>(null)

  if (!me) return <><AppBar title="Demo devices" back="/" /><Loading /></>
  if (simulator && sims.error && !sims.data) return <><AppBar title="Demo devices" back="/" /><ErrorBox error={sims.error} /></>
  if (simulator && !sims.data) return <><AppBar title="Demo devices" back="/" /><Loading /></>

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id)
    try {
      await fn()
      toast(done)
      sims.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const ppd = simulator ? sims.data!.filter((d) => d.mode === 'ppd') : []
  const network = simulator ? sims.data!.filter((d) => d.mode === 'network') : []
  const real = (devices ?? []).filter((d) => d.live?.kind === 'real')

  const card = (d: SimDevice) => {
    const s = STATE[d.state]
    const on = d.mode === 'ppd' ? d.wanted === 'connected' : d.wanted === 'on_network'
    const label = d.mode === 'ppd' ? (on ? 'Unplug' : 'Connect') : on ? 'Leave network' : 'Join network'
    const run = () =>
      d.mode === 'ppd'
        ? act(d.id, () => (on ? api.simDisconnect(d.id) : api.simConnect(d.id)), on ? `${d.short_name} unplugged. It goes stale once its receipt expires.` : `${d.short_name} is connecting to the home gateway.`)
        : act(d.id, () => api.simNetwork(d.id, !on), on ? `${d.short_name} left the network.` : `${d.short_name} joined the network without PPD.`)
    return (
      <div key={d.id} className="cell d" style={{ alignItems: 'flex-start' }}>
        <div style={{ paddingTop: 12 }}><DeviceTile device={{ ...d, source: 'declared', kind: 'simulated', category: '', category_label: '', matter: false, declaration: null, declaration_id_example: '', flow_count: 0 }} /></div>
        <div className="cb">
          <span className="ttl">{d.short_name}</span>
          <span className="sub">{d.hostname} · {d.ip_address}</span>
          <span className="ln"><span className={`chip ${s.cls}`}>{s.label}</span>{d.last_event && <span className="sub" style={{ fontSize: 13 }}>{d.last_event}{d.last_event_at ? ` · ${timeAgo(d.last_event_at)}` : ''}</span>}</span>
          {d.last_error && <span className="sub" style={{ fontSize: 13, color: '#B3261E' }}>{d.last_error}</span>}
        </div>
        <span className="tr" style={{ paddingTop: 12 }}>
          <button className={on ? 'btn2' : 'btn'} style={{ flex: 'none', minHeight: 36, padding: '0 16px' }} disabled={busy === d.id} onClick={run}>{label}</button>
        </span>
      </div>
    )
  }

  return (
    <div className="screen">
      <AppBar title="Demo devices" back="/" />
      <div className="sf" style={{ paddingTop: 0 }}>
        For the presenter. Simulated devices reach the home gateway the same way real ones do; My home learns about them from the gateway, so keep it open on another screen and watch them join.
      </div>

      <SectionHeader>Real devices</SectionHeader>
      {real.length ? real.map((d) => (
        <div key={d.id}>
          <Group>
            <Cell className="d" to={`/device/${encodeURIComponent(d.id)}`}>
              <DeviceTile device={d} />
              <div className="cb"><span className="ttl">{d.short_name}</span><span className="sub">Real hardware · {d.live?.association.label ?? 'connected'}</span></div>
            </Cell>
          </Group>
          <TelemetryCard device={d} />
          {me.role === 'operator' && <DemoControls device={d} />}
        </div>
      )) : (
        <Group><Cell chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="ttl">No real device is connected</span><span className="sub">Plug in the ESP32 smart bulb; it shows up here once it joins the home.</span></div></Cell></Group>
      )}
      <Footnote>What the bulb uploaded and the remote controls play the device maker’s side. They are not PPD: they go through the gateway’s demo extension (/ppd-demo/v1). PPD only delivers the household’s rules and records that the device received them.</Footnote>

      {simulator ? (
        <>
          <SectionHeader>Join through PPD</SectionHeader>
          <Group>{ppd.map(card)}</Group>
          <Footnote>Simulated devices only take part in PPD: they send no data and take no commands. Connect: the device joins the network, registers, declares what it does, receives your rules and confirms them. Unplug: it stops renewing and turns stale once its receipt expires.</Footnote>

          <SectionHeader>On the network without PPD</SectionHeader>
          <Group>{network.map(card)}</Group>
          <Footnote>Appears under “On your network, no PPD” in My home. It never receives your rules.</Footnote>
        </>
      ) : (
        <Footnote>The demo simulator is off. Start app-api with SIMULATOR=1 to add simulated devices.</Footnote>
      )}

      <div className="gap" />
      {simulator && <Group>
        <Cell className="t" chevron={false} onClick={() => { if (window.confirm('Turn every simulated device off and remove them from the network?')) void act('reset', () => api.simReset(), 'All simulated devices are off.') }}>
          <div className="cb" style={{ padding: '12px 0' }}><span className="ttl" style={{ color: '#B3261E' }}>Reset demo devices</span><span className="sub">Unplug every simulated device and take them off the network</span></div>
        </Cell>
      </Group>}
      <Footnote><Link to="/" className="link">My home</Link></Footnote>
      <div className="spacer" />
    </div>
  )
}
