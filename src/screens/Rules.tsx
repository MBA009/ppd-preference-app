import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Rule } from '../api'
import { ActionBar, AppBar, Cell, Footnote, Group, Loading, SectionHeader, Segmented, Tile } from '../components/ui'
import { ChevronDown, ChipGlyph, Icon, ShieldCheck } from '../components/icons'
import { useDevices, useHousehold, useRules } from '../state/data'
import { ruleCovers, rulesOverlap, strictness } from '../policy/scope'
import { CONDITION_TEXT, KIND, kindOf, type RuleKind } from '../policy/choices'
import { plural } from '../lib/verdicts'
import Onboarding from './Onboarding'
import { PublishCard, PublishedRules } from '../components/Publish'

/**
 * The household policy page. On first launch it asks the questions; afterwards it lists the household's rules (from
 * its answers, then its own), grouped by what they do. The preset behind them is internal and never shown.
 */
export default function Rules() {
  const { household } = useHousehold()
  if (!household) return <><AppBar title="Household rules" /><Loading /></>
  if (!household.preset_id) return <Onboarding />
  return <Policy />
}

const GROUPS: { kind: RuleKind; blurb: string; tone: 'red' | 'blue' | 'green'; icon: JSX.Element }[] = [
  { kind: 'never', tone: 'red', icon: <Icon name="block" size={18} />, blurb: 'A device that does this conflicts with your rules, and is told no. If two rules disagree, the stricter one wins.' },
  { kind: 'limited', tone: 'blue', icon: <ChipGlyph verdict="conditionally_satisfiable" size={16} />, blurb: 'A device that does this is told the condition, and matches with limits.' },
  { kind: 'allow', tone: 'green', icon: <Icon name="check" size={18} />, blurb: 'A device that does this matches your rules.' },
]
const GROUP_TITLE: Record<RuleKind, string> = { never: 'Never', limited: 'Allowed with a condition', allow: 'Allowed' }

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
  const { household, saveProfile, resetDemo, toast } = useHousehold()
  const [confirmReset, setConfirmReset] = useState(false)
  const [open, setOpen] = useState<Partial<Record<RuleKind, boolean>>>({})
  const rules = useRules()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)

  // For each rule: the data flows across the devices in the home it covers, and of those the ones it decides. Where a
  // stricter rule also covers a flow, the stricter one wins (Never, then Allow only if, then Allow), so this rule is
  // overridden there. `stricter` says whether a stricter rule overlaps it at all, devices or not.
  const impact = useMemo(() => {
    const out: Record<string, { flows: number; devices: number; decided: number; stricter: boolean }> = {}
    for (const r of rules) {
      const above = r.enabled ? rules.filter((o) => o.id !== r.id && strictness(o) > strictness(r) && rulesOverlap(r, o)) : []
      let flows = 0
      let decided = 0
      let ds = 0
      for (const d of devices ?? []) {
        const covered = d.flows.filter((f) => ruleCovers({ ...r, enabled: true }, f.taxonomy))
        flows += covered.length
        decided += covered.filter((f) => !above.some((o) => ruleCovers(o, f.taxonomy))).length
        if (covered.length) ds += 1
      }
      out[r.id] = { flows, devices: ds, decided, stricter: above.length > 0 }
    }
    return out
  }, [rules, devices])

  if (!household) return <><AppBar title="Household rules" /><Loading /></>

  const profile = household.profile ?? { summary_frequency: 'monthly' as const, warn_on_conflict: true }
  const fromAnswers = rules.filter((r) => r.origin.kind === 'answer').length
  const added = rules.filter((r) => r.origin.kind === 'custom').length

  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return }
    await resetDemo('seed')
    toast('Everything was reset')
    nav('/rules', { replace: true })
  }

  const setProfile = (patch: Partial<typeof profile>) => void saveProfile({ ...profile, ...patch })

  // The group already says Never / Allowed, so a title's own "Never:" or "Allow only if …:" is left out.
  const shortTitle = (r: Rule) => r.title.replace(/^(Never|Allow(?: only if [^:]*)?):\s*/, '')
  const used = (r: Rule) => impact[r.id]?.decided ?? 0
  const overridden = (r: Rule) => !!impact[r.id]?.stricter
  const counts = GROUPS.map((g) => ({ kind: g.kind, n: rules.filter((r) => kindOf(r) === g.kind).length })).filter((c) => c.n)
  const inUseTotal = rules.filter((r) => used(r) > 0).length

  // Rules your devices use stand out (the kind's colour down the left, the flows in a tinted badge); the rest are
  // kept quietly for devices that may join.
  // A rule a stricter rule overrides gets a warning: all of it on the devices (orange, not "in use"), part of it, or only
  // for flows no device has yet.
  const row = (r: Rule) => {
    const i = impact[r.id]
    const live = !!i?.decided
    const beaten = i ? i.flows - i.decided : 0
    const whollyBeaten = !!i && i.flows > 0 && !i.decided
    const color = KIND[kindOf(r)].color
    const cls = (r.enabled ? '' : 'dim') + (live ? ' inuse' : whollyBeaten && devices ? ' beaten' : ' idle')
    return (
      <Cell key={r.id} to={`/rules/${encodeURIComponent(r.id)}`} className={cls} style={live ? { ['--k' as string]: color } : undefined}>
        <div className="cb">
          <span className="ttl" style={{ fontSize: 15, lineHeight: '20px' }}>{shortTitle(r)}</span>
          {r.condition && <span className="sub">Only if {CONDITION_TEXT[r.condition]}</span>}
          {devices && live && <span className="use"><i />In use · {plural(i.decided, 'data flow')} on {plural(i.devices, 'device')}</span>}
          {devices && whollyBeaten && <span className="warn">⚠ Overridden · a stricter rule decides its {plural(i.flows, 'data flow')}</span>}
          {devices && live && beaten > 0 && <span className="warn">⚠ Overridden on {plural(beaten, 'more data flow')} by a stricter rule</span>}
          {(!devices || !i?.flows) && overridden(r) && <span className="warn">⚠ Partly overridden by a stricter rule</span>}
          {devices && !i?.flows && !overridden(r) && <span className="sub">Not in use yet</span>}
        </div>
        {!r.enabled && <span className="tr off">Off</span>}
      </Cell>
    )
  }

  const subhead = (text: string) => <div className="cell sub-h">{text}</div>

  return (
    <div className="screen">
      <AppBar title="Household rules" right={<Link className="ntr" aria-label="Add a rule" to="/rules/new"><Icon name="plus" /></Link>} />

      {isNew && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="green" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>Your household policy is ready</span>
              <span className="sub">Your answers gave you {plural(rules.length, 'rule')}{fromAnswers ? `, ${fromAnswers} of them for situations you answered directly` : ''}. Look them over. Tap any rule to change it, switch it off, or add your own.</span>
            </div>
          </Cell>
        </Group>
      )}


      {!isNew && <PublishCard />}

      {rules.length > 0 && (
        <div className="grp ov">
          <div className="ov-top">
            <div>
              <div className="ov-n">{rules.length}</div>
              <div className="sub">household {rules.length === 1 ? 'rule' : 'rules'}</div>
            </div>
            {devices && devices.length > 0 && (
              <div className="ov-use"><b>{inUseTotal}</b> in use by your {plural(devices.length, 'device')}</div>
            )}
          </div>
          <div className="ov-bar" aria-hidden="true">
            {counts.map((c) => <i key={c.kind} style={{ flex: c.n, background: KIND[c.kind].color }} />)}
          </div>
          <div className="ov-legend">
            {counts.map((c) => (
              <span key={c.kind}><i style={{ background: KIND[c.kind].color }} />{GROUP_TITLE[c.kind]} <b>{c.n}</b></span>
            ))}
          </div>
        </div>
      )}

      {GROUPS.map((g) => {
        // Rules your devices use first; the rest are kept for devices that may join.
        const list = rules.filter((r) => kindOf(r) === g.kind).sort((a, b) => Number(used(b) > 0) - Number(used(a) > 0))
        if (!list.length) return null
        const k = KIND[g.kind]
        const inUse = list.filter((r) => used(r) > 0).length
        const beaten = list.filter(overridden).length
        const isOpen = !!open[g.kind]
        return (
          <div key={g.kind}>
            <Group style={{ marginTop: 8 }}>
              <button className="cell t" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.kind]: !isOpen }))}>
                <Tile tone={g.tone}>{g.icon}</Tile>
                <div className="cb" style={{ padding: '12px 0' }}>
                  <span className="ttl" style={{ fontWeight: 500, color: k.color }}>{GROUP_TITLE[g.kind]}</span>
                  <span className="sub">
                    {devices ? (inUse ? `${inUse} in use by your devices` : 'Not in use by your devices yet') : g.blurb}
                    {beaten > 0 && <span className="warn-t"> · ⚠ {beaten} overridden by stricter rules</span>}
                  </span>
                </div>
                <span className="tr"><span className="cnt">{list.length}</span><ChevronDown up={isOpen} /></span>
              </button>
              {isOpen && devices && inUse > 0 && subhead('In use by your devices')}
              {isOpen && list.filter((r) => used(r) > 0).map(row)}
              {isOpen && devices && inUse > 0 && inUse < list.length && subhead('Not in use by your devices')}
              {isOpen && list.filter((r) => !(used(r) > 0)).sort((a, b) => Number(overridden(b)) - Number(overridden(a))).map(row)}
            </Group>
            {isOpen && <Footnote>{g.blurb}</Footnote>}
          </div>
        )
      })}

      {!rules.length && (
        <Group style={{ marginTop: 8 }}>
          <Cell className="t" chevron={false}>
            <div className="cb"><span className="ttl">No rules yet</span><span className="sub">Devices that stay in your home match. Anything that leaves it is not allowed.</span></div>
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

      {!isNew && <PublishedRules />}

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
        <Cell className="t" to="/rules/refine">
          <div className="cb"><span className="ttl">Help me refine my settings</span><span className="sub">A few situations households like yours are split on. A good privacy checkup now and then.</span></div>
        </Cell>
        <Cell className="t" to="/rules/update">
          <div className="cb"><span className="ttl">Answer the questions again</span><span className="sub">Starts over: your rules are rebuilt from your new answers{added ? `, replacing the ${plural(added, 'rule')} you added and your changes` : ', replacing your changes'}.</span></div>
        </Cell>
        <Cell className="t" to="/rules/json">
          <div className="cb"><span className="ttl">See the rules as JSON</span><span className="sub">Your household rules, and the PPD policy your devices receive</span></div>
        </Cell>
        <Cell className="t" to="/rules/sources">
          <div className="cb"><span className="ttl">How the questions were made</span><span className="sub">Synthetic households from published studies</span></div>
        </Cell>
      </Group>

      <div className="gap" />
      <Group>
        <Cell className="t" chevron={false} onClick={reset}>
          <div className="cb">
            <span className="ttl" style={{ color: '#B3261E' }}>{confirmReset ? 'Tap again to reset everything' : 'Reset everything'}</span>
            <span className="sub">Clears your answers and rules, including rules you added, and starts again with the questions. Connected devices stay.</span>
          </div>
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
