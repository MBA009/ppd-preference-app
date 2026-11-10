import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionBar, AppBar, DeviceTile, ErrorBox, Footnote, Group, Loading, SectionHeader, Cell } from '../components/ui'
import { FlowRow, PpdStatus } from '../components/DeviceReport'
import { DataflowDiagram, DataflowLegend, contextSplit, matches, whoOf, type Pick } from '../components/DataflowDiagram'
import { useDevice, useHousehold } from '../state/data'
import { VERDICT_ORDER } from '../lib/verdicts'
import { declaredNothing, subtitle, vendorOf } from '../lib/device'

/**
 * Privacy viewer: where a device's data goes, as a picture. Reached from a scanned privacy code (the preview links
 * here), the device page, or directly at /viewer/<device id>. The flows listed under the picture follow what is
 * selected in it.
 */
export default function PrivacyViewer() {
  const { id } = useParams()
  const nav = useNavigate()
  const { household } = useHousehold()
  const dev = useDevice(id)
  const [pick, setPick] = useState<Pick>(null)
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/scan'))

  if (dev.error) return <><AppBar title="Privacy viewer" back={back} /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="Privacy viewer" back={back} /><Loading /></>

  const inHome = household.devices.some((h) => h.device_id === d.id)
  const shown = d.flows.filter((f) => matches(f, pick))
  const worst = (a: typeof shown[0], b: typeof shown[0]) => VERDICT_ORDER.indexOf(a.evaluation.verdict) - VERDICT_ORDER.indexOf(b.evaluation.verdict)
  const groups = [...new Set(shown.map(whoOf))]
    .map((who) => ({ who, flows: shown.filter((f) => whoOf(f) === who).sort(worst) }))
  const split = contextSplit(d)
  const origin = d.source === 'declared'
    ? d.kind === 'research' ? 'From an example declaration in our research' : 'Declared by the device'
    : `From ${vendorOf(d)}’s public statements, read by our team`

  return (
    <div className="screen">
      <AppBar title="Privacy viewer" subtitle={d.short_name} back={back} />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>Where its data goes</div>
            <div className="sub">{subtitle(d, inHome ? 'In your home' : 'Not in your home yet')}</div>
          </div>
        </Cell>
        <PpdStatus device={d} />
      </Group>

      {declaredNothing(d) || d.flows.length === 0 ? (
        <div className="empty">{d.short_name} hasn’t said what it does with your data, so there is nothing to draw.</div>
      ) : (
        <>
          <div className="df-split">
            {split.map((s) => (
              <div key={s.context} className={'df-stat ' + s.context.replace('ppd:', '')}>
                <b>{s.n}</b><span>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="grp df-card">
            <DataflowDiagram device={d} pick={pick} onPick={setPick} />
            <DataflowLegend device={d} />
          </div>
          <Footnote>{origin}. Each band is one or more data flows; its width is how many, its colour how they compare with your household policy. Tap a kind of data or a party to see only those flows.</Footnote>

          <SectionHeader>
            {pick ? (
              <span className="df-filter">
                {pick.side === 'what' ? 'Data: ' : 'Handled by: '}{pick.key} · {shown.length}
                <button className="link" onClick={() => setPick(null)}>Show all</button>
              </span>
            ) : `All ${d.flows.length} flows`}
          </SectionHeader>
          {groups.map((g) => (
            <div key={g.who}>
              <div className="sf" style={{ padding: '6px 32px 6px', fontWeight: 500, color: 'var(--heading)' }}>{g.who} · {g.flows.length}</div>
              <Group>{g.flows.map((f) => <FlowRow key={f.id} device={d} flow={f} />)}</Group>
            </div>
          ))}
        </>
      )}

      <div className="spacer" />
      <ActionBar>
        <Link to="/scan" className="btn2">Scan another box</Link>
        <Link to={inHome ? `/device/${d.id}` : `/preview/${d.id}`} className="btn">{inHome ? 'Open device' : 'Device summary'}</Link>
      </ActionBar>
    </div>
  )
}
