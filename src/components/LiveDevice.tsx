import { useState } from 'react'
import { api, type CommandAction, type Device, type LiveState, type Tone } from '../api'
import { useCommands, useHousehold, useTelemetry } from '../state/data'
import { timeAgo } from '../lib/device'
import { termLabel } from '../../shared/taxonomy'
import { Cell, Footnote, Group, SectionHeader, Segmented, Tile } from './ui'
import { ShieldCheck } from './icons'

/**
 * The gateway's view of a participating device, as the CableLabs dashboard shows it: association,
 * lifecycle, the policy instance delivered and acknowledged, identity, network and reported behavior.
 * Telemetry and guided-demo controls are not PPD; they appear only on the Demo devices page.
 */

const TILE: Record<Tone, 'green' | 'orange' | 'red' | 'grey'> = { good: 'green', warn: 'orange', bad: 'red', neutral: 'grey' }
const shortId = (id: string) => (id.length > 26 ? id.slice(0, 12) + '…' + id.slice(-10) : id)
const when = (iso: string | null) => (iso ? timeAgo(iso) : 'Not yet')

function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="cell kv"><span className="ttl">{k}</span><span className={'v' + (mono ? ' mono' : '')} title={v}>{v}</span></div>
}

/** Association status: the first thing an operator looks at. */
export function AssociationCard({ live }: { live: LiveState }) {
  const a = live.association
  return (
    <Group>
      <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
        <Tile tone={TILE[a.tone]} style={{ marginTop: 10 }}><ShieldCheck /></Tile>
        <div className="cb" style={{ paddingRight: 16 }}>
          <span className="ttl" style={{ fontWeight: 500 }}>{a.label}</span>
          <span className="sub">{a.attention ?? a.explanation ?? ''}</span>
          {a.next_step && <span className="sub" style={{ fontSize: 13 }}>Next: {a.next_step}</span>}
        </div>
      </Cell>
      {live.badges.length > 0 && (
        <div className="cell" style={{ padding: '6px 16px 10px', flexWrap: 'wrap', gap: 6 }}>
          {live.badges.map((b) => <span key={b.label} className={`tag tone-${b.tone}`}>{b.label}</span>)}
        </div>
      )}
    </Group>
  )
}

/** Register → declare → receive rules → confirm receipt → associated, with when each step last happened. */
export function LifecycleSteps({ live }: { live: LiveState }) {
  return (
    <>
      <SectionHeader>How it joined</SectionHeader>
      <Group>
        <ol className="steps">
          {live.lifecycle.map((s) => (
            <li key={s.step} className={s.done ? 'done' : ''}>
              <span className="dot" aria-hidden="true" />
              <span className="ttl">{s.label}</span>
              <span className="sub">{s.done ? when(s.at) : 'Waiting'}</span>
            </li>
          ))}
        </ol>
      </Group>
      {live.association.fresh_until && (
        <Footnote>
          The device renews its receipt every {live.association.freshness_interval ?? 'few minutes'}. Current until {new Date(live.association.fresh_until).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.
        </Footnote>
      )}
    </>
  )
}

const PUBLICATION: Record<LiveState['publication'], string> = {
  current: 'Has your latest rules',
  waiting: 'Waiting for the device to pick up your latest rules',
  not_published: 'No household rules are being served yet',
}

/** Which policy instance the gateway delivered, and the device's receipt for it. */
export function PolicyReceipt({ live }: { live: LiveState }) {
  const p = live.effective_policy
  const r = live.receipt
  return (
    <>
      <SectionHeader>Rules this device received</SectionHeader>
      <Group>
        <Kv k="Status" v={PUBLICATION[live.publication]} />
        {p ? (
          <>
            <Kv k="Household rules" v={p.base_policy_id} mono />
            {p.applied_policy_id && <Kv k="Device exception" v={p.applied_policy_id} mono />}
            <Kv k="Policy instance" v={shortId(p.policy_id)} mono />
            <Kv k="Delivered" v={when(p.retrieved_at)} />
          </>
        ) : (
          <Kv k="Delivered" v="Not yet" />
        )}
        <Kv k="Receipt" v={r ? (r.current ? `Confirmed ${when(r.acknowledged_at)}` : 'For an older instance') : 'Not confirmed'} />
      </Group>
      <Footnote>A receipt means the device said it received exactly these rules. It is not proof that it follows them.</Footnote>
    </>
  )
}

export function IdentityAndNetwork({ live }: { live: LiveState }) {
  const n = live.network
  return (
    <>
      <SectionHeader>Identity and network</SectionHeader>
      <Group>
        <Kv k="Firmware" v={live.registration.firmware_version || 'Not stated'} />
        <Kv k="Identity" v={live.identity.label} />
        <Kv k="Declaration" v={live.declaration_id ?? 'None'} mono />
        <Kv k="Seen on the home network" v={n.observed ? n.label : 'Not available in the cloud deployment'} />
        {n.hostname && <Kv k="Reported hostname" v={n.hostname} mono />}
      </Group>
    </>
  )
}

/** What the device reports it does at run time, kept apart from the receipt. */
export function ReportedBehavior({ live }: { live: LiveState }) {
  const r = live.runtime
  if (!r.behavior_mode && !r.conflict_active) return null
  return (
    <>
      <SectionHeader>What it reports doing</SectionHeader>
      <Group>
        <Kv k="Behavior" v={r.behavior_mode === 'fixed-permissive' || r.behavior_mode === 'fixed_permissive' ? 'Ignores your rules (demo)' : 'Follows your rules'} />
        <Kv k="Conflict" v={r.conflict_active ? `Sends ${r.conflicting_purposes.map((p) => termLabel('purpose', p).toLowerCase()).join(', ')} data your rules deny` : 'None reported'} />
      </Group>
    </>
  )
}

/** Recent sensor uploads per purpose. Silence alone is not proof that a device complied. */
export function TelemetryCard({ device }: { device: Device }) {
  const { data } = useTelemetry(device.id)
  if (!data) return null
  const latest = data.samples[0]
  return (
    <>
      <SectionHeader>What it uploaded</SectionHeader>
      <Group>
        {!data.by_purpose.length && <Kv k="Nothing uploaded yet" v="" />}
        {data.by_purpose.map((p) => <Kv key={p.purpose} k={p.label} v={`${p.count} ${p.count === 1 ? 'sample' : 'samples'} · last ${when(p.last_at)}`} />)}
        {latest && <Kv k="Latest reading" v={[latest.temperature_c !== null ? `${latest.temperature_c} °C` : null, latest.humidity_pct !== null ? `${latest.humidity_pct} %` : null].filter(Boolean).join(' · ')} />}
      </Group>
      <Footnote>Uploads reach the demo cloud through the gateway. A purpose with no new samples may be blocked by your rules, or the device may simply be quiet.</Footnote>
    </>
  )
}

const STATUS_LABEL = { queued: 'Waiting for the device', delivered: 'Sent to the device', completed: 'Done', skipped: 'Skipped', failed: 'Failed', expired: 'Expired' } as const

/** Guided-demo controls for real hardware. The device polls for these; queued is not done. */
export function DemoControls({ device }: { device: Device }) {
  const { toast } = useHousehold()
  const { data: commands, reload } = useCommands(device.id)
  const [mode, setMode] = useState<'adaptive' | 'fixed_permissive'>(device.live?.runtime.behavior_mode === 'fixed-permissive' ? 'fixed_permissive' : 'adaptive')
  if (device.live?.kind !== 'real') return null

  const send = async (action: CommandAction, value?: string) => {
    try {
      await api.sendCommand(device.id, action, value)
      toast('Sent. The device picks it up within a few seconds.')
      reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const last = commands?.[0]
  return (
    <>
      <SectionHeader>Demo controls</SectionHeader>
      <Group>
        <Cell className="t" onClick={() => send('advance_step')} chevron={false}>
          <div className="cb"><span className="ttl" style={{ color: '#0066CC' }}>Advance one step</span><span className="sub">In guided mode the device waits between steps</span></div>
        </Cell>
        <div className="cell rowq">
          <div><span className="ttl">How the device behaves</span></div>
          <Segmented full label="Behavior" value={mode} onChange={(v) => { setMode(v); void send('set_behavior_mode', v) }} options={[{ value: 'adaptive', label: 'Follows rules' }, { value: 'fixed_permissive', label: 'Ignores rules' }]} />
        </div>
        <Cell className="t" onClick={() => send('set_lifecycle_mode', 'guided')} chevron={false}><div className="cb"><span className="ttl">Switch to guided mode</span></div></Cell>
        <Cell className="t" onClick={() => send('set_lifecycle_mode', 'automatic')} chevron={false}><div className="cb"><span className="ttl">Switch to automatic mode</span></div></Cell>
        <Cell className="t" onClick={() => send('reassociate')} chevron={false}><div className="cb"><span className="ttl">Restart association</span><span className="sub">The device registers and declares again</span></div></Cell>
      </Group>
      {last && <Footnote>Last command: {last.action.replace(/_/g, ' ')}{last.value ? ` (${last.value.replace(/_/g, ' ')})` : ''} · {STATUS_LABEL[last.status]}{last.detail ? ` · ${last.detail}` : ''}</Footnote>}
    </>
  )
}
