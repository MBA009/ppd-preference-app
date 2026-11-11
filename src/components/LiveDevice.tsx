import { useState } from 'react'
import { api, type CommandAction, type Device, type LiveState } from '../api'
import { useCommands, useHousehold, useTelemetry } from '../state/data'
import { DEVICE_STATE, deviceState, timeAgo, type DeviceStateKey } from '../lib/device'
import { termLabel } from '../../shared/taxonomy'
import { Cell, Footnote, Group, SectionHeader, Segmented, StateChip, Tile } from './ui'
import { ChipGlyph } from './icons'
import { FlowRow } from './DeviceReport'

/**
 * The gateway's view of a participating device, as the CableLabs dashboard shows it: association,
 * lifecycle, the policy instance delivered and acknowledged, identity, network and reported behavior.
 * Telemetry and guided-demo controls are not PPD; they appear only on the Demo devices page.
 */

const shortId = (id: string) => (id.length > 26 ? id.slice(0, 12) + '…' + id.slice(-10) : id)
const when = (iso: string | null) => (iso ? timeAgo(iso) : 'Not yet')

function Kv({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="cell kv"><span className="ttl">{k}</span><span className={'v' + (mono ? ' mono' : '')} title={v}>{v}</span></div>
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** What the state adds, per the design board's "What the app shows" column. */
function stateDetail(key: DeviceStateKey, live: LiveState): string | null {
  const a = live.association
  switch (key) {
    case 'confirmed':
    case 'no_declaration':
      return a.fresh_until ? `Its confirmation runs out at ${clock(a.fresh_until)} unless it renews.` : null
    case 'waiting':
      return a.fresh_until ? `Your verdicts already use the new rules. The device has until ${clock(a.fresh_until)} to fetch them.` : 'Your verdicts already use the new rules.'
    case 'stale':
      return a.renewed_at ? `Last confirmed ${timeAgo(a.renewed_at)}.` : null
    case 'reassociate':
      return a.attention
    default:
      return null
  }
}

/** The device's state: the first thing to look at. The draft's association states, in household words. */
export function AssociationCard({ device, live }: { device: Device; live: LiveState }) {
  const key = deviceState(device)
  const detail = stateDetail(key, live)
  return (
    <Group>
      <Cell className="t" chevron={false} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6, padding: '12px 16px' }}>
        <StateChip device={device} />
        <span className="sub">{DEVICE_STATE[key].meaning}</span>
        {detail && <span className="sub" style={{ fontSize: 13 }}>{detail}</span>}
      </Cell>
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
  not_published: 'No household policy is being served yet',
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
            <Kv k="Household policy" v={p.base_policy_id} mono />
            {p.applied_policy_id && <Kv k="Device exception" v={p.applied_policy_id} mono />}
            <Kv k="Policy instance" v={shortId(p.policy_id)} mono />
            <Kv k="Delivered" v={when(p.retrieved_at)} />
          </>
        ) : (
          <Kv k="Delivered" v="Not yet" />
        )}
        <Kv k="Receipt" v={r ? (r.current ? `Confirmed ${when(r.acknowledged_at)}` : 'For an older instance') : 'Not confirmed'} />
      </Group>
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
        <Kv k="Seen on the home network" v={n.observed ? ['Yes', n.ip_address].filter(Boolean).join(' · ') : 'Not available in the cloud deployment'} />
        {n.hostname && <Kv k="Reported hostname" v={n.hostname} mono />}
      </Group>
    </>
  )
}

/** behavior_mode values from the ESP32 bulb (and our simulator). */
const IGNORES = new Set(['fixed-permissive', 'fixed_permissive'])
const purposeList = (r: LiveState['runtime']) => r.conflicting_purposes.map((p) => termLabel('purpose', p)).join(', ')

/**
 * A loud warning near the top of the device page when the device's runtime-status report (a CableLabs gateway
 * demo extension, not PPD) says it ignores the household policy or sent data the policy denies. Lists the
 * device's flows with that purpose that the policy says no to.
 */
export function RuntimeWarning({ device, live }: { device: Device; live: LiveState }) {
  const r = live.runtime
  const ignores = !!r.behavior_mode && IGNORES.has(r.behavior_mode)
  if (!r.conflict_active && !ignores) return null
  const denied = device.flows.filter((f) => f.evaluation.verdict === 'unsatisfiable' && r.conflicting_purposes.includes(f.taxonomy.purpose))
  return (
    <>
      <Group style={{ boxShadow: 'inset 0 0 0 1.5px var(--bad)' }}>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="red" style={{ marginTop: 10 }}><ChipGlyph verdict="unsatisfiable" size={17} /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 600, color: 'var(--bad)' }}>{r.conflict_active ? 'Sent data your household policy denies' : 'Ignores your household policy'}</span>
            <span className="sub">
              {r.conflict_active
                ? `The device reports it sent data for ${purposeList(r).toLowerCase() || 'a purpose'} anyway.`
                : 'The device reports it will send data even where your household policy says no.'}
            </span>
          </div>
        </Cell>
        {denied.map((f) => <FlowRow key={f.id} device={device} flow={f} />)}
      </Group>
      <div className="gap" />
    </>
  )
}

/** The device's runtime-status report (POST device/runtime-status), named as in the CableLabs status interface. */
export function ReportedBehavior({ live }: { live: LiveState }) {
  const r = live.runtime
  if (!r.behavior_mode && !r.conflict_active) return null
  return (
    <>
      <SectionHeader>Runtime status</SectionHeader>
      <Group>
        <Kv k="Behavior" v={!r.behavior_mode ? 'Not reported' : IGNORES.has(r.behavior_mode) ? 'Ignores rules' : r.behavior_mode === 'adaptive' ? 'Follows rules' : r.behavior_mode} />
        <Kv k="Conflict" v={r.conflict_active ? purposeList(r) || 'Yes' : 'None'} />
        {r.reported_at && <Kv k="Last report" v={timeAgo(r.reported_at)} />}
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
