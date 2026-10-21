import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Rule, RuleEffect } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader, Segmented, Tile } from '../components/ui'
import { Icon, ShieldCheck } from '../components/icons'
import { useDevices, useHousehold, useQuestionnaire, useRules } from '../state/data'
import { matchesScope } from '../policy/scope'
import { originLabel } from '../policy/generate'
import { plural } from '../lib/verdicts'
import Questionnaire from './Questionnaire'

/**
 * The household policy page. On first launch (no answers yet) it asks the questions;
 * afterwards it lists the rules those answers made, grouped by what they do, and lets the person change them.
 */
export default function Rules() {
  const { household } = useHousehold()
  if (!household) return <><AppBar title="Household rules" /><Loading /></>
  if (household.answers === null) return <Questionnaire />
  return <Policy />
}

const GROUPS: { effect: RuleEffect; title: string; blurb: string; color: string }[] = [
  { effect: 'dont_allow', title: 'Never', blurb: 'A device that does this conflicts with your rules.', color: '#B3261E' },
  { effect: 'ask', title: 'Ask me first', blurb: 'A device that does this waits for your decision.', color: '#8A4B00' },
  { effect: 'allow', title: 'Allowed', blurb: 'A device that does this matches your rules.', color: '#1E7D34' },
]

const FREQ = [
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'never', label: 'Never' },
] as const

function Policy() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const { household, savePolicy } = useHousehold()
  const { data: tree, error } = useQuestionnaire()
  const rules = useRules()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)

  // For each rule: how many data flows across the devices in the home does it speak to?
  const impact = useMemo(() => {
    const out: Record<string, { flows: number; devices: number }> = {}
    for (const r of rules) {
      let flows = 0
      let ds = 0
      for (const d of devices ?? []) {
        const n = d.flows.filter((f) => matchesScope(f, r.scope)).length
        flows += n
        if (n) ds += 1
      }
      out[r.id] = { flows, devices: ds }
    }
    return out
  }, [rules, devices])

  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!household || !tree) return <><AppBar title="Household rules" /><Loading /></>

  const profile = household.profile ?? { summary_frequency: 'monthly' as const, warn_on_conflict: true }
  const made = rules.filter((r) => r.origin.kind === 'questionnaire').length
  const added = rules.length - made

  const setProfile = (patch: Partial<typeof profile>) => {
    const next = { ...profile, ...patch }
    const pq = tree.questions.find((k) => k.type === 'profile')
    const answers = { ...(household.answers ?? {}) }
    if (pq) answers[pq.id] = { ...(typeof answers[pq.id] === 'object' ? (answers[pq.id] as Record<string, string | boolean>) : {}), ...next }
    void savePolicy({ answers, rules, profile: next })
  }

  const row = (r: Rule) => {
    const i = impact[r.id]
    const origin = originLabel(tree, r)
    return (
      <Cell key={r.id} to={`/rules/${encodeURIComponent(r.id)}`} className={r.enabled ? '' : 'dim'}>
        <div className="cb">
          <span className="ttl">{r.title}</span>
          <span className="sub">
            {origin ? `From your answer: ${origin}` : 'Added by you'}
            {devices && ` · ${i && i.flows ? `${plural(i.flows, 'data flow')} on ${plural(i.devices, 'device')}` : 'no device in your home does this'}`}
          </span>
        </div>
        {!r.enabled && <span className="tr off">Off</span>}
      </Cell>
    )
  }

  return (
    <div className="screen">
      <AppBar title="Household rules" right={<Link className="ntr" aria-label="Add a rule" to="/rules/new"><Icon name="plus" /></Link>} />

      {isNew && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="green" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>Your household policy is ready</span>
              <span className="sub">We made {plural(made, 'rule')} from your answers. Look them over. Tap any rule to change it, switch it off, or add your own.</span>
            </div>
          </Cell>
        </Group>
      )}

      {!isNew && (
        <div className="sf" style={{ paddingTop: 0 }}>
          Every device is checked against these rules. If two rules disagree, the stricter one wins.
        </div>
      )}

      {GROUPS.map((g) => {
        const list = rules.filter((r) => r.effect === g.effect)
        if (!list.length) return null
        return (
          <div key={g.effect}>
            <SectionHeader><span style={{ color: g.color }}>{g.title}</span> · {list.length}</SectionHeader>
            <Group>{list.map(row)}</Group>
            <Footnote>{g.blurb}</Footnote>
          </div>
        )
      })}

      {!rules.length && (
        <Group style={{ marginTop: 8 }}>
          <Cell className="t" chevron={false}>
            <div className="cb"><span className="ttl">No rules yet</span><span className="sub">Devices that stay in your home match. Anything that leaves it will wait for your decision.</span></div>
          </Cell>
        </Group>
      )}

      <div className="gap" />
      <Group>
        <Cell className="t" to="/rules/new">
          <Tile tone="blue"><Icon name="plus" size={18} /></Tile>
          <div className="cb"><span className="ttl" style={{ color: '#0066CC' }}>Add a rule</span></div>
        </Cell>
      </Group>

      <SectionHeader>Keeping you posted</SectionHeader>
      <Group>
        <div className="cell rowq">
          <div><span className="ttl" style={{ fontWeight: 500 }}>A summary of what your devices do with your data</span></div>
          <Segmented full label="Summary frequency" value={profile.summary_frequency} options={[...FREQ]} onChange={(v) => setProfile({ summary_frequency: v })} />
        </div>
        <Cell className="t" chevron={false}>
          <div className="cb"><span className="ttl">Warn me when a device conflicts with my rules</span></div>
          <span className="tr" style={{ display: 'flex' }}>
            <button className="tr" role="switch" aria-checked={profile.warn_on_conflict} aria-label="Warn me when a device conflicts with my rules" style={{ minHeight: 44 }} onClick={() => setProfile({ warn_on_conflict: !profile.warn_on_conflict })}>
              <span className={'sw' + (profile.warn_on_conflict ? ' on' : '')} />
            </button>
          </span>
        </Cell>
      </Group>
      <Footnote>Saved with your policy. The app does not send summaries or warnings yet.</Footnote>

      <SectionHeader>Your answers</SectionHeader>
      <Group>
        <Cell className="t" to="/rules/update">
          <div className="cb"><span className="ttl">Answer the questions again</span><span className="sub">Rules made from your answers are replaced. {added ? `The ${plural(added, 'rule')} you added stay.` : 'Rules you add yourself stay.'}</span></div>
        </Cell>
        <Cell className="t" to="/rules/sources">
          <div className="cb"><span className="ttl">Where the questions come from</span><span className="sub">Four research papers</span></div>
        </Cell>
      </Group>

      <div className="spacer" />
      {isNew ? (
        <ActionBar><button className="btn" onClick={() => nav('/', { replace: true })}>Looks good</button></ActionBar>
      ) : (
        <div className="sf" style={{ textAlign: 'center', padding: '16px 32px 4px' }}><Link to="/dev" className="link" style={{ fontSize: 13 }}>Test tools</Link></div>
      )}
    </div>
  )
}
