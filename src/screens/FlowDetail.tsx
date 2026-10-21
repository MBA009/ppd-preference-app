import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Device, Flow, Preference } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, Segmented, SectionHeader, Switch, Tile } from '../components/ui'
import { flowPath } from '../components/DeviceReport'
import { ChevronDown, ChipGlyph } from '../components/icons'
import { useDevice, useHousehold } from '../state/data'
import { PREFERENCE_LABEL, VERDICTS, decisionFor } from '../lib/verdicts'
import { nounOf } from '../components/DeviceReport'

const REGIONS = ['United States', 'European Union', 'Anywhere']

/** Screen 2b (and the detail view for any other flow). Control is shown as one read-only line and never changes a verdict. */
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
  const nav = useNavigate()
  const { household, saveDecision, toast } = useHousehold()
  const inHome = !!household?.devices.some((h) => h.device_id === device.id)
  const verdict = flow.evaluation.verdict
  const meta = VERDICTS[verdict]
  const existing = decisionFor(flow, household)

  const queue = device.flows.filter((f) => f.evaluation.verdict === 'decision_required')
  const pos = queue.findIndex((f) => f.id === flow.id)
  const canDecide = verdict === 'decision_required' && inHome

  const [pref, setPref] = useState<Preference | null>(existing?.preference ?? null)
  const [keep, setKeep] = useState<'briefly' | 'until_deleted'>(existing?.keep ?? 'briefly')
  const [region, setRegion] = useState(existing?.region ?? REGIONS[0])
  const [remember, setRemember] = useState(existing?.remember_similar ?? false)
  useEffect(() => { window.scrollTo(0, 0) }, [flow.id])

  const nextUndecided = () => queue.slice(pos + 1).concat(queue.slice(0, pos)).find((f) => !decisionFor(f, household) && f.id !== flow.id)
  const goNext = () => {
    const n = nextUndecided()
    nav(n ? flowPath(device.id, n.id) : `/device/${device.id}`, { replace: true })
  }

  const save = async () => {
    if (!pref) return
    await saveDecision({
      flow_id: flow.id, device_id: device.id, preference: pref,
      keep: pref === 'allow_with_limits' ? keep : undefined, region: pref === 'allow_with_limits' ? region : undefined,
      remember_similar: remember, core_group_id: flow.core_group.id,
    })
    toast('Preference saved')
    goNext()
  }

  const decided = verdict === 'decision_required' && existing
  const bannerTitle = decided ? `You chose: ${PREFERENCE_LABEL[existing.preference]}` : meta.label
  const f = flow.display
  const rows: [string, string][] = [['What', f.what], ['Why', f.why], ['What happens', f.what_happens], ['Comes from', f.comes_from], ['Handled by', f.handled_by], ['Kept', f.kept]]
  if (f.limit) rows.push(['Stays', f.limit])

  return (
    <div className="screen">
      <AppBar
        title={flow.title}
        subtitle={verdict === 'decision_required' && pos >= 0 ? `${pos + 1} of ${queue.length}` : undefined}
        back={`/device/${device.id}`}
        right={canDecide && queue.length > 1 ? <button className="ntr" onClick={goNext}>Skip</button> : undefined}
      />

      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={meta.tile} style={{ marginTop: 10 }}><ChipGlyph verdict={verdict} size={17} /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{bannerTitle}</span>
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

      {canDecide && (
        <>
          <SectionHeader>Your preference</SectionHeader>
          <Group>
            <div role="radiogroup" aria-label="Your preference">
              {(['allow', 'allow_with_limits', 'dont_allow'] as Preference[]).map((p) => (
                <div key={p}>
                  <button className="cell" role="radio" aria-checked={pref === p} onClick={() => setPref(p)}>
                    <span className={'rd' + (pref === p ? ' on' : '')} />
                    <div className="cb" style={{ padding: '11px 0' }}><span className="ttl">{PREFERENCE_LABEL[p]}</span></div>
                    <span className="tr" />
                  </button>
                  {p === 'allow_with_limits' && pref === p && (
                    <>
                      <div className="cell ind" style={{ paddingLeft: 50, minHeight: 48 }}>
                        <span className="nowrap" style={{ fontSize: 14, lineHeight: '20px' }}>Keep it</span><span style={{ flex: 1 }} />
                        <Segmented label="Keep it" value={keep} onChange={setKeep} options={[{ value: 'briefly', label: 'Briefly' }, { value: 'until_deleted', label: 'Until deleted' }]} />
                      </div>
                      <label className="cell ind" style={{ paddingLeft: 50 }}>
                        <span className="nowrap" style={{ fontSize: 14, lineHeight: '20px' }}>Handled in</span><span style={{ flex: 1 }} />
                        <span className="tr pick" style={{ fontSize: 14, lineHeight: '20px' }}>
                          {region}<ChevronDown />
                          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Handled in">
                            {REGIONS.map((r) => <option key={r}>{r}</option>)}
                          </select>
                        </span>
                      </label>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Group>
          <Group style={{ marginTop: 12 }}>
            <div className="cell">
              <div className="cb" style={{ padding: '8px 0' }}>
                <span className="ttl">Remember for similar flows</span>
                <span className="sub" style={{ fontSize: 13, lineHeight: '16px' }}>{flow.core_group.label}</span>
              </div>
              <Switch on={remember} onChange={setRemember} label="Remember for similar flows" />
            </div>
          </Group>
        </>
      )}

      {verdict === 'decision_required' && !inHome && (
        <Footnote>Add this device to your home to set a preference. <Link to="/library" className="link">Device library</Link></Footnote>
      )}
      {verdict === 'unsatisfiable' && (
        <Footnote>Your rules say no to this. Devices that get your rules are asked to follow them, but we can’t check that they do.</Footnote>
      )}
      {verdict === 'indeterminate' && (
        <Footnote>We will compare this flow once a source is found or the device declares it.</Footnote>
      )}
      {flow.evaluation.rule_id && (
        <Footnote>This comes from one of your household rules. <Link to={`/rules/${encodeURIComponent(flow.evaluation.rule_id)}`} className="link">View the rule</Link></Footnote>
      )}

      <div className="spacer" />
      {canDecide && (
        <ActionBar><button className="btn" disabled={!pref} onClick={save}>Save preference</button></ActionBar>
      )}
    </div>
  )
}
