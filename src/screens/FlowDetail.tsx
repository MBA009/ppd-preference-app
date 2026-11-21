import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Device, Flow, Rule } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader, Tile } from '../components/ui'
import { ruleSentence, ruleTitle } from '../../shared/ruleTitle'
import { ChipGlyph, Icon } from '../components/icons'
import { kindOf, type RuleKind } from '../policy/choices'
import { useDevice, useHousehold } from '../state/data'
import { VERDICTS } from '../lib/verdicts'
import { nounOf } from '../components/DeviceReport'

/**
 * What one flow does and how it compares with the household's rules. Control is shown as one line and never
 * changes a verdict. A flow none of the household's rules covers ("Needs your decision") can be answered here;
 * the answer is saved as a new rule for exactly this kind of data flow.
 */
/**
 * Back to wherever the flow was opened from (the device page, or a notice on My Home), or to the device page when the
 * flow was opened directly. React Router's history index says whether there is an app page to go back to.
 */
function useBack(deviceId: string) {
  const nav = useNavigate()
  return () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav(`/device/${encodeURIComponent(deviceId)}`, { replace: true }))
}

export default function FlowDetail() {
  const { id, flowId } = useParams()
  const dev = useDevice(id)
  const { household } = useHousehold()
  if (dev.error) return <><AppBar title="Flow" back={true} /><ErrorBox error={dev.error} /></>
  const d = dev.data
  const flow = d?.flows.find((f) => f.id === flowId)
  if (!d || !household) return <><AppBar title="Flow" back={true} /><Loading /></>
  if (!flow) return <><AppBar title="Flow" back={`/device/${d.id}`} /><ErrorBox error={new Error('That flow is not in this device’s declaration.')} /></>
  const rule = household.rules.find((r) => r.id === flow.evaluation.rule_id) ?? null
  return <Detail key={flow.id} device={d} flow={flow} rule={rule} />
}

/** How each kind of rule looks on its card, as in the groups on the profile page. */
const KIND_LOOK: Record<RuleKind, { label: string; tone: 'red' | 'blue' | 'green'; icon: JSX.Element }> = {
  never: { label: 'Never', tone: 'red', icon: <Icon name="block" size={18} /> },
  limited: { label: 'Allowed with a condition', tone: 'blue', icon: <ChipGlyph verdict="conditionally_satisfiable" size={16} /> },
  allow: { label: 'Allowed', tone: 'green', icon: <Icon name="check" size={18} /> },
}

function Detail({ device, flow, rule }: { device: Device; flow: Flow; rule: Rule | null }) {
  const back = useBack(device.id)
  const verdict = flow.evaluation.verdict
  const meta = VERDICTS[verdict]
  // The rule is shown on its own card just below, so the reason doesn't quote its long name.
  const reason = rule ? flow.evaluation.reason.replace(/Your rule “[^”]*”/, 'Your rule') : flow.evaluation.reason
  const decided = rule && ruleSentence(rule)
  const look = rule && KIND_LOOK[kindOf(rule)]
  useEffect(() => { window.scrollTo(0, 0) }, [flow.id])

  const f = flow.display
  const rows: [string, string][] = [['What', f.what], ['Why', f.why], ['What happens', f.what_happens], ['Comes from', f.comes_from], ['Handled by', f.handled_by], ['Kept', f.kept]]
  if (f.limit) rows.push(['Stays', f.limit])

  return (
    <div className="screen">
      <AppBar title={flow.title} back={back} />

      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={meta.tile} style={{ marginTop: 10 }}><ChipGlyph verdict={verdict} size={17} /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{meta.label}</span>
            <span className="sub">{reason}</span>
          </div>
        </Cell>
      </Group>

      {rule && decided && look && (
        <>
          <SectionHeader>The rule that decides this</SectionHeader>
          <Group>
            <Cell className="t" to={`/rules/${encodeURIComponent(rule.id)}`} style={{ alignItems: 'flex-start' }} aria-label={`Open the rule: ${decided.sentence}`}>
              <Tile tone={look.tone} style={{ marginTop: 12 }}>{look.icon}</Tile>
              <div className="cb" style={{ padding: '12px 0' }}>
                <span className="sub" style={{ fontSize: 13, fontWeight: 500 }}>{look.label}</span>
                <span className="ttl rule-what">{decided.head}</span>
                <span className="sub rule-rest">{decided.why}</span>
                {decided.more.map((m) => <span key={m} className="sub rule-rest">{m}</span>)}
              </div>
            </Cell>
          </Group>
        </>
      )}

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
        <Footnote>Your rules say no to this, and devices that get your rules are told so. {rule ? 'To allow it, tap the rule above and change it.' : 'To allow it, change your rules.'}</Footnote>
      )}
      {verdict === 'conditionally_satisfiable' && flow.evaluation.rule_id && (
        <Footnote>Devices that get your rules receive this condition with the rule.</Footnote>
      )}
      {verdict === 'decision_required' && <Decide device={device} flow={flow} />}
      {verdict === 'indeterminate' && (
        <Footnote>Indeterminate: this flow uses terms the app doesn’t recognise, so it can’t be compared with your rules. We assume nothing about it and there is nothing for you to do. Your privacy profile still applies to the device.</Footnote>
      )}
      {flow.evidence === 'needs_source' && (
        <Footnote>We found this flow in our research but haven’t found where the maker says it yet, so treat it as likely rather than confirmed.</Footnote>
      )}
      <div className="spacer" />
    </div>
  )
}

/** Answers a flow no rule covers with a new rule scoped to its exact five terms. */
function Decide({ device, flow }: { device: Device; flow: Flow }) {
  const back = useBack(device.id)
  const { upsertRule, toast } = useHousehold()
  const [busy, setBusy] = useState(false)
  const t = flow.taxonomy
  const answer = async (effect: Rule['effect']) => {
    setBusy(true)
    const draft: Rule = {
      id: `custom.${Date.now().toString(36)}`, title: '', effect, condition: null, enabled: true, origin: { kind: 'custom' },
      scope: { data_type: [t.data_type], purpose: [t.purpose], action: [t.action], source: [t.source], handling_context: [t.handling_context] },
    }
    try {
      await upsertRule({ ...draft, title: ruleTitle(draft) })
      toast(effect === 'allow' ? 'Allowed. Saved as a new rule.' : 'Saved as a new rule: never.')
      back()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Footnote>Your profile has no recommendation for this, so your devices get no rule for it and decide it themselves. Your answer is saved as a new rule for this kind of data flow, on every device.</Footnote>
      <ActionBar>
        <button className="btn2" disabled={busy} onClick={() => answer('dont_allow')}>Never</button>
        <button className="btn" disabled={busy} onClick={() => answer('allow')}>Allow</button>
      </ActionBar>
    </>
  )
}
