import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Device, Flow } from '../api'
import { ActionBar, AppBar, Cell, DeviceTile, ErrorBox, Footnote, Group, Loading, SectionHeader, VerdictMark } from '../components/ui'
import { FlowRow, PpdStatus } from '../components/DeviceReport'
import { DataflowDiagram, DataflowLegend, contextSplit, matches, whoOf, type Pick } from '../components/DataflowDiagram'
import { useDevice, useHousehold } from '../state/data'
import { VERDICTS, VERDICT_ORDER } from '../lib/verdicts'
import type { Verdict } from '../api'
import { declaredNothing, supportsPpd } from '../lib/device'
import { deviceFromCode, loadScanned } from '../lib/declarationCode'

/**
 * Privacy viewer: where a device that supports PPD says its data goes, as a picture.
 *
 * - /viewer/scanned: the declaration read from a scanned privacy code (the code carries the JSON; lib/declarationCode.ts),
 *   checked against the household's rules on this phone.
 * - /viewer/<device id>: a device the app already knows (from the device page or the Test tools).
 */
export default function PrivacyViewer() {
  const { id } = useParams()
  return id === 'scanned' ? <ScannedViewer /> : <StoredViewer id={id} />
}

function useBack() {
  const nav = useNavigate()
  return () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/scan'))
}

function ScannedViewer() {
  const back = useBack()
  const { household } = useHousehold()
  const code = useMemo(loadScanned, [])
  const device = useMemo(() => (code && household ? deviceFromCode(code, household.rules) : null), [code, household])
  if (!code) return <><AppBar title="Privacy viewer" back={back} /><div className="empty">Scan a privacy code to see where a device’s data goes.</div></>
  if (!device || !household) return <><AppBar title="Privacy viewer" back={back} /><Loading /></>
  return <ViewerBody device={device} back={back} scanned />
}

function StoredViewer({ id }: { id: string | undefined }) {
  const back = useBack()
  const dev = useDevice(id)
  const { household } = useHousehold()
  if (dev.error) return <><AppBar title="Privacy viewer" back={back} /><ErrorBox error={dev.error} /></>
  if (!dev.data || !household) return <><AppBar title="Privacy viewer" back={back} /><Loading /></>
  return <ViewerBody device={dev.data} back={back} />
}

/** A flow from a scanned code: the code has no flow page, so a tap shows how it compares with the rules here. */
function CodeFlowRow({ flow }: { flow: Flow }) {
  const [open, setOpen] = useState(false)
  return (
    <Cell onClick={() => setOpen(!open)} chevron={false} aria-expanded={open}>
      <div className="cb" style={{ paddingRight: 16 }}>
        <span className={'ttl' + (open ? '' : ' clamp2')}>{flow.title}</span>
        <span className="ln nw">
          <VerdictMark verdict={flow.evaluation.verdict} />
          <span className="sub">{`${flow.summary_parts.who} · ${flow.summary_parts.purpose}`}</span>
        </span>
        {open && <span className="sub" style={{ marginTop: 4 }}><b>{VERDICTS[flow.evaluation.verdict].label}.</b> {flow.evaluation.reason}</span>}
      </div>
    </Cell>
  )
}

function ViewerBody({ device: d, back, scanned = false }: { device: Device; back: () => void; scanned?: boolean }) {
  const [pick, setPick] = useState<Pick>(null)

  const shown = d.flows.filter((f) => matches(f, pick))
  const worst = (a: Flow, b: Flow) => VERDICT_ORDER.indexOf(a.evaluation.verdict) - VERDICT_ORDER.indexOf(b.evaluation.verdict)
  const groups = [...new Set(shown.map(whoOf))].map((who) => ({ who, flows: shown.filter((f) => whoOf(f) === who).sort(worst) }))
  const split = contextSplit(d)
  const origin = 'What the device declares, compared with your household policy on this phone'

  return (
    <div className="screen">
      <AppBar title="Privacy viewer" subtitle={d.short_name} back={back} />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>Where its data goes</div>
            <div className="sub">{`${d.category_label} · ${d.flows.length} data flows`}</div>
          </div>
        </Cell>
        <PpdStatus device={d} viewer />
      </Group>

      {!supportsPpd(d) ? (
        <div className="empty">{d.short_name} doesn’t support PPD, so it hasn’t declared its data flows. The privacy viewer shows devices that do.</div>
      ) : declaredNothing(d) || d.flows.length === 0 ? (
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
            <DataflowLegend device={d} pick={pick} onPick={setPick} />
          </div>
          <Footnote>{origin}. Each band is one or more data flows; its width is how many, its colour how they compare with your household policy. Tap a kind of data, a place it goes, or a verdict to see only those flows.</Footnote>

          <SectionHeader>
            {pick ? (
              <span className="df-filter">
                {pick.side === 'verdict' ? VERDICTS[pick.key as Verdict].label : pick.side === 'what' ? `Data: ${pick.key}` : pick.key === 'Stays in your home' ? pick.key : `Goes to: ${pick.key}`} · {shown.length}
                <button className="link" onClick={() => setPick(null)}>Show all</button>
              </span>
            ) : `All ${d.flows.length} flows`}
          </SectionHeader>
          {groups.map((g) => (
            <div key={g.who}>
              {pick?.side !== 'who' && <div className="sf" style={{ padding: '6px 32px 6px', fontWeight: 500, color: 'var(--heading)' }}>{g.who} · {g.flows.length}</div>}
              <Group>{g.flows.map((f) => (scanned ? <CodeFlowRow key={f.id} flow={f} /> : <FlowRow key={f.id} device={d} flow={f} />))}</Group>
            </div>
          ))}
        </>
      )}

      <div className="spacer" />
      <ActionBar>
        <Link to="/scan" className="btn">Scan another box</Link>
      </ActionBar>
    </div>
  )
}
