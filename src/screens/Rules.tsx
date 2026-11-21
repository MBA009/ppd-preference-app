import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Rule } from '../api'
import { ActionBar, AppBar, Cell, Expander, Footnote, Group, Loading, SectionHeader, Tile, VerdictChips } from '../components/ui'
import { ChevronDown, ChipGlyph, Icon, ShieldCheck } from '../components/icons'
import { useDevices, useHousehold, useOnboarding, useRules } from '../state/data'
import { decisionKey, ruleCovers, rulesOverlap, undecidedFlows } from '../policy/scope'
import { KIND, kindOf, type RuleKind } from '../policy/choices'
import { conditionText } from '../../shared/conditions'
import { VERDICT_ORDER, countVerdicts, plural } from '../lib/verdicts'
import { timeAgo } from '../lib/device'
import { refineQueue } from '../../shared/onboarding'
import { ruleSentence } from '../../shared/ruleTitle'
import Onboarding from './Onboarding'
import { PublishCard } from '../components/Publish'

/**
 * The privacy profile page. On first launch it asks the questions; afterwards it lists the household's rules (from
 * its answers, then its own), grouped by what they do. The preset behind them is internal and never shown.
 */
export default function Rules() {
  const { household } = useHousehold()
  if (!household) return <><AppBar title="Privacy profile" brand /><Loading /></>
  if (!household.preset_id) return <Onboarding />
  return <Policy />
}

const GROUPS: { kind: RuleKind; blurb: string; tone: 'red' | 'blue' | 'green'; icon: JSX.Element }[] = [
  { kind: 'never', tone: 'red', icon: <Icon name="block" size={18} />, blurb: 'Your devices are told not to do these. If two rules disagree, your latest change wins.' },
  { kind: 'limited', tone: 'blue', icon: <ChipGlyph verdict="conditionally_satisfiable" size={16} />, blurb: 'Allowed only under the condition shown.' },
  { kind: 'allow', tone: 'green', icon: <Icon name="check" size={18} />, blurb: 'Your devices may do these.' },
]
const GROUP_TITLE: Record<RuleKind, string> = { never: 'Never', limited: 'Allowed with a condition', allow: 'Allowed' }

function Policy() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const { household, resetDemo, toast } = useHousehold()
  const [confirmReset, setConfirmReset] = useState(false)
  const [open, setOpen] = useState<Partial<Record<RuleKind, boolean>>>({})
  const [showQuiet, setShowQuiet] = useState<Partial<Record<RuleKind, boolean>>>({})
  const [about, setAbout] = useState(false)
  const rules = useRules()
  const tree = useOnboarding()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)

  // For each rule: the data flows across the devices in the home it covers, and of those the ones it decides. Where a
  // later rule that says something else also covers a flow, the later one wins (the latest change, Nov 2), so this
  // rule is overridden there. `later` says whether such a rule overlaps it at all, devices or not. Rules are kept
  // oldest change first.
  const impact = useMemo(() => {
    const out: Record<string, { flows: number; devices: number; decided: number; later: boolean }> = {}
    for (const [i, r] of rules.entries()) {
      const above = r.enabled ? rules.slice(i + 1).filter((o) => decisionKey(o) !== decisionKey(r) && rulesOverlap(r, o)) : []
      let flows = 0
      let decided = 0
      let ds = 0
      for (const d of devices ?? []) {
        const covered = d.flows.filter((f) => ruleCovers({ ...r, enabled: true }, f.taxonomy))
        flows += covered.length
        decided += covered.filter((f) => !above.some((o) => ruleCovers(o, f.taxonomy))).length
        if (covered.length) ds += 1
      }
      out[r.id] = { flows, devices: ds, decided, later: above.length > 0 }
    }
    return out
  }, [rules, devices])

  // Flows no rule decides: a rule that covered them was deleted or switched off (Nov 2: no preference yet).
  const gap = useMemo(() => undecidedFlows(rules).length, [rules])

  if (!household) return <><AppBar title="Privacy profile" brand /><Loading /></>

  const decide = (devices ?? []).reduce((n, d) => n + d.flows.filter((f) => f.evaluation.verdict === 'decision_required').length, 0)
  const fromAnswers = rules.filter((r) => r.origin.kind === 'answer').length
  const added = rules.filter((r) => r.origin.kind === 'custom').length
  const refine = tree.data ? refineQueue(tree.data, household) : null
  const lastAnswer = Object.values(household.answered_at ?? {}).sort().pop()
  const refineText: React.ReactNode = !refine
    ? 'Situations households like yours have different views on. A good privacy checkup now and then.'
    : refine.undecided
      ? `${plural(refine.undecided, 'situation has', 'situations have')} no recommendation since you removed a rule${decide ? ', including some of what your devices do' : ''}. After that, situations households like yours have different views on.`
      : refine.goodPicture
        ? `We have a good picture of what you want. Check your answers now and then${lastAnswer ? ` (last answer ${timeAgo(lastAnswer)})` : ''}.`
        : <>Households like yours have different views on <b>{refine.split}</b> more {refine.split === 1 ? 'situation' : 'situations'}. Answer as many as you like; your changes stay.</>

  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return }
    await resetDemo('seed')
    toast('Everything was reset')
    nav('/rules', { replace: true })
  }


  const used = (r: Rule) => impact[r.id]?.decided ?? 0
  const overridden = (r: Rule) => !!impact[r.id]?.later
  // Every kind is counted, even at 0, so it's clear what kinds of rule there are.
  const counts = GROUPS.map((g) => ({ kind: g.kind, n: rules.filter((r) => kindOf(r) === g.kind).length }))
  const inUseTotal = rules.filter((r) => used(r) > 0).length
  // What the rules mean for the devices in the home, over every flow they say they have.
  const verdicts: ReturnType<typeof countVerdicts> = {}
  for (const d of devices ?? []) {
    for (const [v, n] of Object.entries(countVerdicts(d)) as [keyof typeof verdicts, number][]) verdicts[v] = (verdicts[v] ?? 0) + n
  }

  // Rules your devices use stand out (the kind's colour down the left, the flows in a tinted badge); the rest are
  // kept quietly for devices that may join.
  // A rule a later rule overrides gets a warning: all of it on the devices (orange, not "in use"), part of it, or only
  // for flows no device has yet.
  const row = (r: Rule) => {
    const i = impact[r.id]
    const live = !!i?.decided
    const beaten = i ? i.flows - i.decided : 0
    const whollyBeaten = !!i && i.flows > 0 && !i.decided
    const color = KIND[kindOf(r)].color
    const cls = (r.enabled ? '' : 'dim') + (live ? ' inuse' : whollyBeaten && devices ? ' beaten' : ' idle')
    // In sentences: what data and where it goes, then why, then anything narrower. The group already says Never or Allowed.
    const s = ruleSentence(r)
    return (
      <Cell key={r.id} to={`/rules/${encodeURIComponent(r.id)}`} className={cls} style={live ? { ['--k' as string]: color } : undefined}>
        <div className="cb">
          <span className="ttl rule-what">{s.head}</span>
          <span className="sub rule-rest">{s.why}</span>
          {s.more.map((m) => <span key={m} className="sub rule-rest">{m}</span>)}
          {r.condition && <span className="sub">Only if {conditionText(r.condition)}</span>}
          {devices && live && <span className="use"><i />Used by {i.devices} of your devices</span>}
          {devices && whollyBeaten && <span className="warn">⚠ Replaced by a newer rule</span>}
          {devices && live && beaten > 0 && <span className="warn">⚠ Partly replaced by a newer rule</span>}
          {(!devices || !i?.flows) && overridden(r) && <span className="warn">⚠ Partly replaced by a newer rule</span>}
        </div>
        {!r.enabled && <span className="tr off">Off</span>}
      </Cell>
    )
  }

  const subhead = (text: string) => <div className="cell sub-h">{text}</div>

  return (
    <div className="screen">
      <AppBar title="Privacy profile" brand right={<Link className="ntr" aria-label="Add a rule" to="/rules/new"><Icon name="plus" /></Link>} />

      {/* What this page is, for anyone new to it. Folded so it doesn't push the rules down. */}
      <Group style={{ marginBottom: 8 }}>
        <button className="cell t" aria-expanded={about} onClick={() => setAbout(!about)}>
          <Tile tone="blue"><ShieldCheck /></Tile>
          <div className="cb" style={{ padding: '12px 0' }}>
            <span className="ttl" style={{ fontWeight: 500 }}>What is a privacy profile?</span>
            {!about && <span className="sub">The rules your smart devices receive, and how they work</span>}
          </div>
          <span className="tr"><ChevronDown up={about} /></span>
        </button>
        {about && (
          <div className="about">
            <p>Your privacy profile is a set of rules about what smart devices may do with your data. Devices that can receive your privacy preferences get these rules automatically.</p>
            <p><b>Never</b> means devices are told not to do it. <b>Allowed</b> means they may. Each rule says what data, where it goes, and why.</p>
            <p>Your rules came from your answers. You can change any rule, add your own, or fine-tune your profile with a few more questions.</p>
            <p>For each device, the app compares what it says it does with your rules.</p>
          </div>
        )}
      </Group>

      {isNew && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="green" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>Your privacy profile is ready</span>
              <span className="sub">Your answers gave you {plural(rules.length, 'rule')}{fromAnswers ? `, ${fromAnswers} of them for situations you answered directly` : ''}. Look them over. Tap any rule to change it, switch it off, or add your own.</span>
            </div>
          </Cell>
        </Group>
      )}


      {/* Flows a removed rule left with no rule. What the devices in the home do comes first: that needs deciding now
          (orange); the rest only matters if a device that does it joins (blue). */}
      {gap > 0 && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" to="/rules/settle" style={{ alignItems: 'flex-start' }}>
            <Tile tone={decide ? 'orange' : 'green'} style={{ marginTop: 10 }}>{decide ? <Icon name="status" size={18} /> : <Icon name="check" size={18} />}</Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>
                {decide ? 'It’s now unclear what you want for some of what your devices do' : 'Everything is working'}
              </span>
              <span className="sub">
                {decide
                  ? 'You removed or switched off a rule. Tap to decide.'
                  : 'Some situations no longer have a rule because you removed one. They only matter for devices you might buy later, so no action is needed.'}
              </span>
            </div>
          </Cell>
        </Group>
      )}

      {rules.length > 0 && (
        <div className="grp ov" data-tour="rules-overview">
          <div className="ov-top">
            <div>
              <div className="ov-n">{rules.length}</div>
              <div className="sub">{rules.length === 1 ? 'rule' : 'rules'} in your profile</div>
            </div>
            {devices && devices.length > 0 && (
              <div className="ov-use"><b>{inUseTotal}</b> used by your devices</div>
            )}
          </div>
          <div className="ov-bar" aria-hidden="true">
            {counts.filter((c) => c.n).map((c) => <i key={c.kind} style={{ flex: c.n, background: KIND[c.kind].color }} />)}
          </div>
          <div className="ov-legend">
            {counts.map((c) => (
              <span key={c.kind}><i style={{ background: KIND[c.kind].color }} />{GROUP_TITLE[c.kind]} <b>{c.n}</b></span>
            ))}
          </div>
          {devices && devices.length > 0 && (
            <Link className="ov-devices" to="/">
              <span className="sub">What your devices say they do, checked against your rules</span>
              <VerdictChips counts={verdicts} order={VERDICT_ORDER} />
            </Link>
          )}
        </div>
      )}

      {!isNew && <div style={{ marginTop: 8 }} data-tour="rules-publish"><PublishCard /></div>}

      {GROUPS.map((g) => {
        // Rules your devices use first; the rest are kept for devices that may join.
        const list = rules.filter((r) => kindOf(r) === g.kind).sort((a, b) => Number(used(b) > 0) - Number(used(a) > 0))
        if (!list.length) return null
        const k = KIND[g.kind]
        const inUse = list.filter((r) => used(r) > 0).length
        const beaten = list.filter(overridden).length
        const isOpen = !!open[g.kind]
        // Rules no device uses are kept for devices that may join: folded away while some rules are in use, so the
        // list opens on what matters. A rule with an override warning always shows.
        const unused = list.filter((r) => !(used(r) > 0))
        const quiet = unused.filter((r) => !overridden(r))
        const fold = inUse > 0 && quiet.length > 0
        return (
          <div key={g.kind}>
            <Group style={{ marginTop: 8 }}>
              <button className="cell t" data-tour="rules-group" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.kind]: !isOpen }))}>
                <Tile tone={g.tone}>{g.icon}</Tile>
                <div className="cb" style={{ padding: '12px 0' }}>
                  <span className="ttl" style={{ fontWeight: 500, color: k.color }}>{GROUP_TITLE[g.kind]}</span>
                  <span className="sub">
                    {devices ? (inUse ? `${inUse} used by your devices` : 'None used by your devices yet') : g.blurb}
                    {beaten > 0 && <span className="warn-t"> · ⚠ {beaten} replaced by newer rules</span>}
                  </span>
                </div>
                <span className="tr"><span className="cnt">{list.length}</span><ChevronDown up={isOpen} /></span>
              </button>
              {isOpen && devices && inUse > 0 && subhead('Used by your devices')}
              {isOpen && list.filter((r) => used(r) > 0).map(row)}
              {isOpen && unused.filter(overridden).map(row)}
              {isOpen && fold && (
                <Expander open={!!showQuiet[g.kind]} onToggle={() => setShowQuiet((s) => ({ ...s, [g.kind]: !s[g.kind] }))}>
                  {showQuiet[g.kind] ? 'Hide rules your devices don’t use' : `Show ${plural(quiet.length, 'rule')} your devices don’t use`}
                </Expander>
              )}
              {isOpen && (!fold || showQuiet[g.kind]) && quiet.map(row)}
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

      <SectionHeader>Change your rules</SectionHeader>
      <Group>
        <Cell className="t" to="/rules/refine" data-tour="rules-refine">
          <Tile tone="blue"><ShieldCheck /></Tile>
          <div className="cb"><span className="ttl" style={{ color: '#0066CC', fontWeight: 500 }}>Fine-tune your profile</span><span className="sub">{refineText}</span></div>
        </Cell>
        <Cell className="t" to="/rules/new" data-tour="rules-add">
          <Tile tone="blue"><Icon name="plus" size={18} /></Tile>
          <div className="cb"><span className="ttl" style={{ color: '#0066CC', fontWeight: 500 }}>Add a rule</span></div>
        </Cell>
      </Group>

      <SectionHeader>Learn more</SectionHeader>
      <Group>
        <Cell className="t" to="/rules/sources">
          <div className="cb"><span className="ttl">Why we selected these questions</span><span className="sub">Based on published research, tested on simulated households</span></div>
        </Cell>
        <Cell className="t" to="/rules/json" data-tour="rules-json">
          <div className="cb"><span className="ttl">See the technical version</span><span className="sub">Your rules in a technical format, and the exact file your devices receive</span></div>
        </Cell>
      </Group>

      <SectionHeader>Start over</SectionHeader>
      <Group tour="rules-startover">
        <Cell className="t" to="/rules/update">
          <div className="cb"><span className="ttl">Answer the questions again</span><span className="sub">Your rules are rebuilt from your new answers, and your devices get the new ones in place of the old{added ? `, replacing the ${plural(added, 'rule')} you added and your changes` : ', replacing your changes'}.</span></div>
        </Cell>
        <Cell className="t" chevron={false} onClick={reset}>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ color: '#B3261E' }}>{confirmReset ? 'Tap again to reset everything' : 'Reset everything'}</span>
            <span className="sub">Clears your answers and rules, including rules you added, and starts again with the questions. Connected devices stay connected, but will no longer be aware of your previous preferences.</span>
          </div>
        </Cell>
      </Group>

      <div className="spacer" />
      {isNew ? (
        <ActionBar aboveTabs><button className="btn" data-tour="rules-done" onClick={() => nav('/', { replace: true })}>Looks good</button></ActionBar>
      ) : (
        <div className="sf" style={{ textAlign: 'center', padding: '16px 32px 4px' }}><Link to="/dev" className="link" style={{ fontSize: 13 }}>Test tools</Link></div>
      )}
    </div>
  )
}
