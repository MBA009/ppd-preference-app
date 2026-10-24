import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type Device, type SimConsole, type SimOutcome } from '../api'
import { AppBar, Cell, DeviceTile, ErrorBox, Footnote, Group, Loading, SectionHeader, Segmented } from '../components/ui'
import { DemoControls, TelemetryCard } from '../components/LiveDevice'
import { useDevice, useHousehold, useMe, useSimConsole, useSimDevices } from '../state/data'
import { timeAgo } from '../lib/device'

/**
 * One device's demo console (/demo-devices/:id): the device's own side, not PPD. It shows what using the device
 * does with the household's data under the policy the device received. Simulated devices are driven from here;
 * the ESP32 bulb shows what it uploaded and takes remote demo commands.
 */
export default function DeviceConsole() {
  const { id } = useParams()
  const { data: me } = useMe()
  const sims = useSimDevices()
  if (!me || (me.simulator && !sims.data && !sims.error)) return <><AppBar title="Device" back="/demo-devices" /><Loading /></>
  const simulated = !!sims.data?.some((d) => d.id === id)
  return simulated ? <SimulatedConsole id={id!} operator={me.role === 'operator'} /> : <RealConsole id={id!} operator={me.role === 'operator'} />
}

const OUTCOME: Record<SimOutcome, { cls: string; text: (recipient: string) => string }> = {
  sent: { cls: 'ok', text: (r) => `Sent · ${r}` },
  kept_home: { cls: 'ok', text: () => 'Stayed in your home' },
  blocked: { cls: 'bad', text: () => 'Held back: your rules say no' },
  held_back: { cls: 'unk', text: () => 'Held back: no rule covers it' },
  sent_against_rules: { cls: 'bad', text: (r) => `Sent against your rules · ${r}` },
  sent_no_ppd: { cls: 'dec', text: (r) => `Sent · ${r} · no PPD` },
}

function SimulatedConsole({ id, operator }: { id: string; operator: boolean }) {
  const con = useSimConsole(id)
  const { toast } = useHousehold()
  const [busy, setBusy] = useState(false)
  if (con.error && !con.data) return <><AppBar title="Device" back="/demo-devices" /><ErrorBox error={con.error} /></>
  const c = con.data
  if (!c) return <><AppBar title="Device" back="/demo-devices" /><Loading /></>
  const d = c.device
  const on = c.ppd ? d.wanted === 'connected' : d.wanted === 'on_network'

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      con.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const power = () => run(() => (c.ppd ? (on ? api.simDisconnect(id) : api.simConnect(id)) : api.simNetwork(id, !on)))

  return (
    <div className="screen">
      <AppBar title={d.short_name} subtitle="Device console · demo" back="/demo-devices" />
      <Group>
        <div className="cell d">
          <DeviceTile device={{ ...d, source: 'declared', kind: 'simulated', category: '', category_label: '', matter: false, declaration: null, declaration_id_example: '', flow_count: 0 }} />
          <div className="cb">
            <span className="ttl">{d.name}</span>
            <span className="sub">{c.ppd ? (c.policy ? `Has the household’s rules · ${c.policy.rules} rules` : on ? 'Joining; no rules yet' : 'Unplugged') : on ? 'On the network · no PPD, never gets your rules' : 'Off the network'}</span>
          </div>
          {operator && (
            <span className="tr"><button className={on ? 'btn2' : 'btn'} style={{ flex: 'none', minHeight: 36, padding: '0 16px' }} disabled={busy} onClick={power}>{c.ppd ? (on ? 'Unplug' : 'Connect') : on ? 'Leave network' : 'Join network'}</button></span>
          )}
        </div>
      </Group>

      {c.state.length > 0 && (
        <>
          <SectionHeader>On the device</SectionHeader>
          <Group>{c.state.map(([k, v]) => <div key={k} className="cell kv"><span className="ttl">{k}</span><span className="v">{v}</span></div>)}</Group>
        </>
      )}

      <SectionHeader>Use it</SectionHeader>
      <Group>
        {c.controls.map((x) => (
          <Cell key={x.id} className="t" chevron={false} onClick={operator && on && !busy ? () => run(() => api.simAction(id, x.id)) : undefined}>
            <div className="cb"><span className="ttl" style={{ color: on ? '#0066CC' : undefined }}>{x.label}</span><span className="sub">{x.hint}</span></div>
          </Cell>
        ))}
      </Group>
      <Footnote>
        {on ? 'Each control does what the real product does, and triggers the data flows it declares.' : c.ppd ? 'Connect it to use it.' : 'Put it on the network to use it.'}
        {c.periodic && ` It also sends a ${c.periodic.label.toLowerCase()} every ${c.periodic.seconds} s while on.`}
      </Footnote>

      {c.ppd && operator && (
        <>
          <SectionHeader>Your rules</SectionHeader>
          <Group>
            <div className="cell rowq">
              <div><span className="ttl">How the device treats your rules</span></div>
              <Segmented full label="Behavior" value={c.behavior} onChange={(v) => void run(() => api.simBehavior(id, v))} options={[{ value: 'follows', label: 'Follows rules' }, { value: 'ignores', label: 'Ignores rules' }]} />
            </div>
          </Group>
          <Footnote>PPD delivers the rules and records that the device received them; it cannot make the device follow them. “Ignores rules” shows what that looks like.</Footnote>
        </>
      )}

      <Totals c={c} />
      <Activity c={c} />
      <div className="spacer" />
    </div>
  )
}

function Totals({ c }: { c: SimConsole }) {
  if (!c.totals.length) return null
  return (
    <>
      <SectionHeader>Leaving your home</SectionHeader>
      <Group>
        {c.totals.map((t) => (
          <div key={t.recipient + t.purpose} className="cell kv">
            <span className="ttl">{t.recipient} · {t.purpose.toLowerCase()}</span>
            <span className="v">{t.sent} sent{t.blocked ? ` · ${t.blocked} held back` : ''}</span>
          </div>
        ))}
      </Group>
    </>
  )
}

function Activity({ c }: { c: SimConsole }) {
  return (
    <>
      <SectionHeader>What it did</SectionHeader>
      {!c.events.length ? (
        <Group><Cell chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="sub">Nothing yet. Use the device above.</span></div></Cell></Group>
      ) : (
        <Group>
          {c.events.slice(0, 15).map((e, i) => (
            <div key={e.at + i} className="cell" style={{ alignItems: 'flex-start' }}>
              <div className="cb" style={{ padding: '10px 0' }}>
                <span className="ttl" style={{ fontWeight: 500 }}>{e.label} <span className="sub" style={{ fontWeight: 400 }}>· {timeAgo(e.at)}</span></span>
                {e.flows.map((f, j) => {
                  const o = OUTCOME[f.outcome]
                  return (
                    <span key={j} className="ln" style={{ alignItems: 'flex-start', marginTop: 4 }}>
                      <span className={`chip ${o.cls}`} style={{ flex: 'none' }}>{o.text(f.recipient)}</span>
                      <span className="sub" style={{ fontSize: 13 }}>{f.title} · {f.purpose.toLowerCase()}{f.condition ? ` · ${f.condition}` : ''}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </Group>
      )}
    </>
  )
}

function RealConsole({ id, operator }: { id: string; operator: boolean }) {
  const dev = useDevice(id, true)
  if (dev.error && !dev.data) return <><AppBar title="Device" back="/demo-devices" /><ErrorBox error={dev.error} /></>
  const d: Device | undefined = dev.data
  if (!d) return <><AppBar title="Device" back="/demo-devices" /><Loading /></>
  return (
    <div className="screen">
      <AppBar title={d.short_name} subtitle="Device console · real hardware" back="/demo-devices" />
      <Group>
        <Cell className="d" to={`/device/${encodeURIComponent(d.id)}`}>
          <DeviceTile device={d} />
          <div className="cb"><span className="ttl">{d.name}</span><span className="sub">{d.live?.association.label ?? 'Not connected'}</span></div>
        </Cell>
      </Group>
      <TelemetryCard device={d} />
      {operator && <DemoControls device={d} />}
      <Footnote>What it uploaded and the remote controls go through the gateway’s demo extension (/ppd-demo/v1), not through PPD. The bulb also takes these from its own push button and USB serial.</Footnote>
      <div className="spacer" />
    </div>
  )
}
