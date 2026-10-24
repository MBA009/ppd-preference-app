import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { Device, Flow } from '../api'
import { AppBar, Cell, ErrorBox, Footnote, Group, Loading, Tile } from '../components/ui'
import { ChipGlyph } from '../components/icons'
import { useDevice, useHousehold } from '../state/data'
import { VERDICTS } from '../lib/verdicts'
import { nounOf } from '../components/DeviceReport'

/**
 * What one flow does and how it compares with the household's rules. Read-only: the household is never asked
 * to decide a single flow (its preset and rules do). Control is shown as one line and never changes a verdict.
 */
export default function FlowDetail() {
  const { id, flowId } = useParams()
  const dev = useDevice(id)
  const { household } = useHousehold()
  if (dev.error) return <><AppBar title="Flow" back={true} /><ErrorBox error={dev.error} /></>
  const d = dev.data
  const flow = d?.flows.find((f) => f.id === flowId)
  if (!d || !household) return <><AppBar title="Flow" back={true} /><Loading /></>
  if (!flow) return <><AppBar title="Flow" back={`/device/${d.id}`} /><ErrorBox error={new Error('That flow is not in this device’s declaration.')} /></>
  return <Detail key={flow.id} device={d} flow={flow} />
}

function Detail({ device, flow }: { device: Device; flow: Flow }) {
  const verdict = flow.evaluation.verdict
  const meta = VERDICTS[verdict]
  useEffect(() => { window.scrollTo(0, 0) }, [flow.id])

  const f = flow.display
  const rows: [string, string][] = [['What', f.what], ['Why', f.why], ['What happens', f.what_happens], ['Comes from', f.comes_from], ['Handled by', f.handled_by], ['Kept', f.kept]]
  if (f.limit) rows.push(['Stays', f.limit])

  return (
    <div className="screen">
      <AppBar title={flow.title} back={`/device/${device.id}`} />

      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={meta.tile} style={{ marginTop: 10 }}><ChipGlyph verdict={verdict} size={17} /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{meta.label}</span>
            <span className="sub">{flow.evaluation.reason}</span>
          </div>
        </Cell>
      </Group>

      <div className="sh" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>What this flow does</span>
        <span style={{ fontWeight: 400 }}>{device.source === 'declared' ? `Declared by ${nounOf(device)}` : 'From our research'}</span>
      </div>
      <Group>
        {rows.map(([k, v]) => (
          <div key={k} className="cell kv"><span className="ttl">{k}</span><span className="v">{v}</span></div>
        ))}
      </Group>

      {/* Control: read-only, from the research workbook. It explains what the person can do; it never changes the verdict. */}
      <Group style={{ marginTop: 10 }}>
        <div className="cell kv" style={{ flexWrap: 'wrap', rowGap: 1 }}>
          <span className="ttl">Control</span><span className="v">{flow.control.type_label}</span>
          {flow.control.note && <span className="sub" style={{ flexBasis: '100%', fontSize: 13, lineHeight: '17px' }}>{flow.control.note}</span>}
        </div>
      </Group>

      {verdict === 'unsatisfiable' && (
        <Footnote>Your rules say no to this, and devices that get your rules are told so. We can’t check that they follow them. To allow it, change your rules.</Footnote>
      )}
      {verdict === 'conditionally_satisfiable' && flow.evaluation.rule_id && (
        <Footnote>Devices that get your rules receive this condition with the rule. We can’t check that they follow it.</Footnote>
      )}
      {verdict === 'indeterminate' && (
        <Footnote>This flow isn’t described in terms we can read, so we assume nothing about it and there is nothing for you to do. Your household rules still apply to the device.</Footnote>
      )}
      {flow.evaluation.rule_id && (
        <Footnote>This comes from one of your household rules. <Link to={`/rules/${encodeURIComponent(flow.evaluation.rule_id)}`} className="link">View the rule</Link></Footnote>
      )}
      <div className="spacer" />
    </div>
  )
}
