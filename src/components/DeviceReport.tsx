import { useState } from 'react'
import type { Device, DeviceSummary, Flow } from '../api'
import { DocIcon, NoDeclarationIcon, ShieldCheck } from './icons'
import { Cell, Expander, Group, SectionHeader, Tile, VerdictChips, VerdictMark } from './ui'
import { VERDICT_ORDER, countVerdicts, needsAttention } from '../lib/verdicts'
import { DEVICE_STATE, declaredNothing, deviceState, isConnected, isPpdExample, vendorOf } from '../lib/device'

const NOUN: Record<string, string> = { thermostat: 'the thermostat', lock: 'the lock', tv: 'the TV', camera: 'the camera', bulb: 'the bulb', plug: 'the plug' }
export const nounOf = (d: DeviceSummary) => NOUN[d.icon] ?? 'the device'

export const flowPath = (deviceId: string, flowId: string) => `/device/${encodeURIComponent(deviceId)}/flow/${encodeURIComponent(flowId)}`

/** Whether the device can receive the household policy at all: the first thing to know about it. */
export function PpdStatus({ device }: { device: DeviceSummary | Device }) {
  const example = isPpdExample(device)
  const yes = isConnected(device) || example
  return (
    <div className={'ppd ' + (yes ? 'yes' : 'no')}>
      {yes ? <ShieldCheck size={20} /> : <NoDeclarationIcon />}
      <div>
        <b>{example ? 'Supports PPD · example' : yes ? 'Supports PPD' : 'Doesn’t support PPD'}</b>
        <span>
          {example
            ? 'An example of a device that supports PPD: it declares what it does with your data. Our team wrote the declaration from research.'
            : yes ? DEVICE_STATE[deviceState(device)].meaning : 'It can’t receive your household policy. What you see here comes from our research.'}
        </span>
      </div>
    </div>
  )
}

/** "Declared by the device" (or "Not declared by LG") plus the verdict chips. Used by 1b, 1c, 2a and 3c. */
export function ProvenanceCard({ device, sub, stacked }: {
  device: Device; sub?: string; stacked?: boolean
}) {
  const counts = countVerdicts(device)
  // Registered, no declaration: no per-flow verdicts, and a line saying why. Nothing is borrowed from our library.
  if (declaredNothing(device)) {
    return (
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="grey" style={{ marginTop: 12 }}><NoDeclarationIcon /></Tile>
          <div className="cb">
            <span className="ttl">Registered, no declaration</span>
            <span className="sub">
              {sub ? `${sub}. ` : ''}{device.short_name} fetched your household policy but hasn’t said what it does with your data. That’s allowed in PPD. With nothing to compare, there are no per-flow verdicts: it’s assumed to follow it, and we can’t check that it does.
            </span>
          </div>
        </Cell>
      </Group>
    )
  }
  // Not "your 42 rules": how many rules the household has says nothing about this device.
  const checked = `${device.flows.length} ${device.flows.length === 1 ? 'flow' : 'flows'} checked against your household policy`
  const declared = device.source === 'declared'
  const example = declared && device.kind === 'research'
  return (
    <Group>
      <Cell className="t" chevron={false}>
        <Tile tone={declared && !example ? 'green' : 'grey'}>{declared && !example ? <ShieldCheck /> : <DocIcon />}</Tile>
        <div className="cb">
          <span className="ttl">{example ? 'Example declaration from our research' : declared ? 'Declared by the device' : `Not declared by ${vendorOf(device)}`}</span>
          <span className="sub">
            {sub ??
              (declared
                ? checked
                : `${vendorOf(device)} doesn’t publish a declaration. This preview comes from ${vendorOf(device)}’s public statements and support pages, read by our team. It is advisory: nothing is sent to ${nounOf(device)}.`)}
          </span>
        </div>
      </Cell>
      <Cell chevron={false} style={stacked || !declared ? { padding: '10px 16px', flexDirection: 'column', alignItems: 'flex-start', gap: 8 } : { padding: '10px 16px' }}>
        {(stacked || !declared) && <span className="sub">{checked}</span>}
        <VerdictChips counts={counts} order={VERDICT_ORDER} />
      </Cell>
    </Group>
  )
}

export function FlowRow({ device, flow }: { device: Device; flow: Flow }) {
  const advisory = device.source === 'advisory'
  const tail = advisory ? (flow.evidence === 'needs_source' ? 'needs source' : 'source-linked') : flow.summary_parts.purpose
  return (
    <Cell to={flowPath(device.id, flow.id)}>
      <div className="cb">
        <span className="ttl clamp2">{flow.title}</span>
        <span className="ln nw">
          <VerdictMark verdict={flow.evaluation.verdict} />
          <span className="sub">{`${flow.summary_parts.who} · ${tail}`}</span>
        </span>
      </div>
    </Cell>
  )
}

/** "Conflicts with your rules · N" with the rest folded behind one expander. */
export function AttentionList({ device, limit = 5, heading = 'Conflicts with your rules' }: {
  device: Device; limit?: number; heading?: string
}) {
  const [open, setOpen] = useState(false)
  const attention = device.flows.filter(needsAttention)
  const decisions = device.flows.filter((f) => f.evaluation.verdict === 'decision_required')
  const others = device.flows.filter((f) => !needsAttention(f) && f.evaluation.verdict !== 'decision_required')
  const shown = open ? attention : attention.slice(0, limit)
  const overflow = attention.length - Math.min(attention.length, limit)
  const allMatch = others.every((f) => f.evaluation.verdict === 'compatible')

  let label = ''
  if (overflow > 0 && others.length > 0) label = `${overflow} more · ${others.length} ${others.length === 1 ? 'other is' : 'others are'} fine`
  else if (overflow > 0) label = `${overflow} more`
  else if (others.length > 0) label = allMatch ? `${others.length} other ${others.length === 1 ? 'flow matches' : 'flows match'}` : `${others.length} other ${others.length === 1 ? 'flow is' : 'flows are'} fine`

  return (
    <>
      {decisions.length > 0 && (
        <>
          <SectionHeader>Needs your decision · {decisions.length}</SectionHeader>
          <Group>{decisions.map((f) => <FlowRow key={f.id} device={device} flow={f} />)}</Group>
          <div className="sf">None of your rules settles these, so your devices get no rule for them. Open one to answer with a new rule.</div>
        </>
      )}
      {attention.length > 0 ? (
        <SectionHeader>{heading} · {attention.length}</SectionHeader>
      ) : (
        <div className="sf">Nothing here conflicts with your rules.</div>
      )}
      <Group style={attention.length ? undefined : { marginTop: 8 }}>
        {shown.map((f) => <FlowRow key={f.id} device={device} flow={f} />)}
        {label && <Expander open={open} onToggle={() => setOpen(!open)}>{open ? 'Show fewer' : label}</Expander>}
        {open && others.map((f) => <FlowRow key={f.id} device={device} flow={f} />)}
      </Group>
    </>
  )
}
