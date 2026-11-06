import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Rule, RuleCondition, RuleScope, Taxonomy } from '../api'
import { ActionBar, AppBar, Cell, Footnote, Group, Loading, Pill, SectionHeader, Switch } from '../components/ui'
import { useDevices, useHousehold } from '../state/data'
import { decisionKey, ruleCovers, rulesOverlap, undecidedFlows } from '../policy/scope'
import { FIELDS } from '../../shared/taxonomy'
import { ruleTitle } from '../../shared/ruleTitle'
import { ACTION_CHOICES, CONDITION_CHOICES, DATA_CHOICES, KEPT_FOREVER, PURPOSE_CHOICES, SOURCE_CHOICES, WHO_CHOICES, isBoundary, isOn, kindOf, toggle, type Choice, type RuleKind } from '../policy/choices'
import { plural } from '../lib/verdicts'
import { PLACES, jurisdictionCondition, jurisdictionOf, type JurisdictionScope } from '../../shared/conditions'

/** Add a rule (/rules/new) or change one (/rules/:ruleId). */
export default function RuleEditor() {
  const { ruleId } = useParams()
  const { household } = useHousehold()
  if (!household) return <><AppBar title="Rule" back="/rules" /><Loading /></>
  const existing = ruleId ? household.rules.find((r) => r.id === ruleId) : undefined
  if (ruleId && !existing) {
    return (
      <div className="screen">
        <AppBar title="Rule" back="/rules" />
        <div className="empty">That rule is gone. <Link to="/rules" className="link">Back to your household policy</Link></div>
      </div>
    )
  }
  return <Editor key={existing?.id ?? 'new'} rule={existing} />
}

/** Which step a place condition limits (taxonomy-05 section 6.7.3), and what that covers. */
const PLACE_SCOPES: { scope: JurisdictionScope; label: string; hint: string }[] = [
  { scope: 'storage', label: 'Stored', hint: 'Where the data may be kept. Covers every kind of handling.' },
  { scope: 'transfer', label: 'Sent to companies', hint: 'The companies it is sent to must be in these places. Covers only sending it on.' },
  { scope: 'collection', label: 'Collected', hint: 'Covers only collecting it; other handling needs a rule of its own.' },
  { scope: 'use', label: 'Used', hint: 'Covers only using it; other handling needs a rule of its own.' },
  { scope: 'inference', label: 'Analyzed', hint: 'Covers only working things out from it; other handling needs a rule of its own.' },
]

const KINDS: { kind: RuleKind; label: string; sub: string }[] = [
  { kind: 'never', label: 'Never', sub: 'A device that does this conflicts with your rules, and is told no.' },
  { kind: 'limited', label: 'Allow only if…', sub: 'Allowed under a condition the device is told, such as not keeping the data.' },
  { kind: 'allow', label: 'Allow', sub: 'A device that does this matches your rules.' },
]

function Editor({ rule }: { rule: Rule | undefined }) {
  const nav = useNavigate()
  const { household, upsertRule, deleteRule, toast } = useHousehold()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)

  const [kind, setKind] = useState<RuleKind>(rule ? kindOf(rule) : 'never')
  const [condition, setCondition] = useState<RuleCondition>(rule?.condition ?? 'processing_boundary=ppd:inHomeOnly')
  const [scope, setScope] = useState<RuleScope>(rule?.scope ?? {})
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const place = jurisdictionOf(condition)
  const togglePlace = (code: string) => {
    if (!place) return
    const codes = place.codes.includes(code) ? place.codes.filter((c) => c !== code) : [...place.codes, code]
    if (codes.length) setCondition(jurisdictionCondition(place.scope, codes))
  }
  const forever = !!scope.constraints?.includes(KEPT_FOREVER)
  const empty = !scope.data_type?.length && !scope.purpose?.length && !scope.handling_context?.length && !scope.action?.length && !scope.source?.length && !scope.constraints?.length
  const effect = kind === 'never' ? 'dont_allow' : 'allow'
  const cond = kind === 'limited' ? condition : null
  // The rule as it would be saved. Its name is generated from it (shared/ruleTitle.ts), never typed.
  const draft: Rule = { id: rule?.id ?? '', title: '', effect, condition: cond, scope, enabled, origin: rule?.origin ?? { kind: 'custom' } }
  const name = ruleTitle(draft)

  const impact = useMemo(() => {
    let flows = 0
    let ds = 0
    for (const d of devices ?? []) {
      const n = d.flows.filter((f) => ruleCovers({ ...draft, enabled: true }, f.taxonomy)).length
      flows += n
      if (n) ds += 1
    }
    return { flows, devices: ds }
  }, [devices, scope, effect, cond])

  // Where rules disagree, the latest change wins (Nov 2), and saving makes this rule the latest: say before saving which
  // rules it will take over from, where they overlap.
  const overrides = (household?.rules ?? []).filter((r) => r.id !== rule?.id && r.enabled && !empty && decisionKey(r) !== decisionKey(draft) && rulesOverlap(draft, r))
  const sharedFlows = (r: Rule) => (devices ?? []).reduce((n, d) => n + d.flows.filter((f) => ruleCovers({ ...draft, enabled: true }, f.taxonomy) && ruleCovers(r, f.taxonomy)).length, 0)

  // What taking this rule away (deleting it, or switching it off) leaves with no rule at all: the household policy then
  // sends devices nothing for those flows, and the household has to decide them (Nov 2: no preference yet).
  const gap = useMemo(() => {
    if (!rule?.enabled) return null
    const all = household?.rules ?? []
    const key = (t: Taxonomy) => FIELDS.map((f) => t[f]).join('|')
    const before = new Set(undecidedFlows(all).map(key))
    const left = new Set(undecidedFlows(all.filter((r) => r.id !== rule.id)).map(key).filter((k) => !before.has(k)))
    const onDevices = (devices ?? []).reduce((n, d) => n + d.flows.filter((f) => left.has(key(f.taxonomy))).length, 0)
    return { flows: left.size, onDevices }
  }, [rule, household?.rules, devices])
  const gapText = (what: string) => gap && (
    <div className="note" role="status" style={{ margin: '12px 16px 0' }}>
      <b>{what} leaves {plural(gap.flows, 'data flow')} with no rule{gap.onDevices ? `, ${gap.onDevices} of them on your devices` : ''}.</b>{' '}
      No other rule covers them, so your devices get no rule for them until you decide{gap.onDevices ? ', and they show as Needs your decision' : ''}.
      You can decide them afterwards from your household policy page. To change what happens instead of removing it, edit the rule and save.
    </div>
  )

  const flip = (key: 'data_type' | 'purpose' | 'handling_context' | 'action' | 'source', c: Choice) =>
    setScope((s) => ({ ...s, [key]: toggle(s[key], c) }))
  const setForever = (on: boolean) =>
    setScope((s) => {
      const rest = (s.constraints ?? []).filter((k) => k !== KEPT_FOREVER)
      const next = on ? [...rest, KEPT_FOREVER] : rest
      return { ...s, constraints: next.length ? next : undefined }
    })

  const save = async () => {
    const next: Rule = {
      id: rule?.id ?? `custom.${Date.now().toString(36)}`,
      title: name,
      effect,
      condition: cond,
      scope,
      enabled,
      origin: rule?.origin ?? { kind: 'custom' },
    }
    await upsertRule(next)
    toast(!rule ? 'Rule added.' : !enabled && gap?.flows ? `Rule switched off. ${plural(gap.flows, 'data flow')} now ${gap.flows === 1 ? 'has' : 'have'} no rule.` : 'Rule saved.')
    nav('/rules', { replace: true })
  }

  const remove = async () => {
    if (!rule) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    await deleteRule(rule.id)
    toast(gap?.flows ? `Rule deleted. ${plural(gap.flows, 'data flow')} now ${gap.flows === 1 ? 'has' : 'have'} no rule.` : 'Rule deleted.')
    nav('/rules', { replace: true })
  }

  const group = (heading: string, hint: string, key: 'data_type' | 'purpose' | 'handling_context' | 'action' | 'source', choices: Choice[]) => (
    <>
      <SectionHeader>{heading}</SectionHeader>
      <div className="pills" role="group" aria-label={heading}>
        {choices.map((c) => <Pill key={c.id} on={isOn(scope[key], c)} onClick={() => flip(key, c)}>{c.label}</Pill>)}
      </div>
      <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>{hint}</div>
    </>
  )

  return (
    <div className="screen">
      <AppBar title={rule ? 'Edit rule' : 'New rule'} back="/rules" />
      <div className="rname" aria-live="polite">
        <span className="sub">This rule</span>
        <span className="ttl">{empty ? 'Pick what it covers below' : name}</span>
      </div>

      <SectionHeader>What should happen</SectionHeader>
      <Group>
        <div role="radiogroup" aria-label="What should happen">
          {KINDS.map((e) => (
            <button key={e.kind} className="cell" role="radio" aria-checked={kind === e.kind} onClick={() => setKind(e.kind)}>
              <span className={'rd' + (kind === e.kind ? ' on' : '')} />
              <div className="cb"><span className="ttl">{e.label}</span><span className="sub">{e.sub}</span></div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>

      {kind === 'limited' && (
        <>
          <SectionHeader>Only if</SectionHeader>
          <div className="pills" role="radiogroup" aria-label="Only if">
            {CONDITION_CHOICES.map((c) => (
              <Pill key={c.id} on={c.condition ? condition === c.condition : !!place} onClick={() => setCondition(c.condition ?? (place ? condition : jurisdictionCondition('storage', ['us'])))}>{c.label}</Pill>
            ))}
          </div>
          {condition === 'retention=ppd:ephemeral' && (
            <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>No retention: the device may use the data, but must not save it. No recordings, history or logs are kept afterwards.</div>
          )}
          {isBoundary(condition) && (
            <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>Where data is processed is defined only for using it and working things out from it, so this rule covers only those. Collecting it and sending it out need a rule of their own.</div>
          )}
          {place && (
            <>
              <SectionHeader>Which step</SectionHeader>
              <div className="pills" role="radiogroup" aria-label="Which step">
                {PLACE_SCOPES.map((p) => <Pill key={p.scope} on={place.scope === p.scope} onClick={() => setCondition(jurisdictionCondition(p.scope, place.codes))}>{p.label}</Pill>)}
              </div>
              <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>{PLACE_SCOPES.find((p) => p.scope === place.scope)!.hint} A rule limits one step; for another step, add another rule.</div>
              <SectionHeader>Only in</SectionHeader>
              <div className="pills" role="group" aria-label="Only in">
                {Object.entries(PLACES).map(([code, name]) => <Pill key={code} on={place.codes.includes(code)} onClick={() => togglePlace(code)}>{name.replace(/^the /, '')}</Pill>)}
              </div>
              <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>A jurisdiction is a country or state whose laws apply. The United States includes California. Your devices are told it with the rule.</div>
            </>
          )}
        </>
      )}

      <div style={{ height: 8, flex: 'none' }} />
      {group('When a device handles this data', 'Pick any. Leave all unpicked to cover every kind of data.', 'data_type', DATA_CHOICES)}
      {group('For this reason', 'Leave all unpicked to cover every reason.', 'purpose', PURPOSE_CHOICES)}
      {group('Handled by', 'Leave all unpicked to cover everyone. “Other companies” means anyone besides the maker and its services.', 'handling_context', WHO_CHOICES)}
      {group('What happens to it', 'Leave all unpicked to cover every kind of handling.', 'action', ACTION_CHOICES)}
      {group('Where the data comes from', 'Leave all unpicked to cover data from anywhere.', 'source', SOURCE_CHOICES)}

      <SectionHeader>Only for devices that</SectionHeader>
      <div className="pills">
        <Pill on={forever} onClick={() => setForever(!forever)}>Say they keep the data forever</Pill>
      </div>
      <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>We can only check this when a device states how long it keeps data. “Not stated” is never treated as forever.</div>

      <div style={{ height: 12, flex: 'none' }} />
      <Group>
        <div className="cell">
          <div className="cb"><span className="ttl">Rule is on</span><span className="sub">Switch off to keep the rule but ignore it.</span></div>
          <Switch on={enabled} onChange={setEnabled} label="Rule is on" />
        </div>
      </Group>

      {!enabled && !!gap?.flows && !confirmDelete && gapText('Switching it off')}
      <div className={empty ? 'note' : 'info'} role="status" style={empty ? { margin: '12px 16px 0' } : undefined}>
        {empty
          ? 'Nothing is picked, so this rule would cover every data flow. Pick at least one thing above to narrow it.'
          : !devices
            ? 'Checking your devices…'
            : impact.flows
              ? `This rule covers ${plural(impact.flows, 'data flow')} on ${plural(impact.devices, 'device')} in your home.`
              : 'No device in your home does this right now. The rule will apply when one does.'}
      </div>
      {enabled && overrides.length > 0 && (
        <div className="note" role="status" style={{ margin: '12px 16px 0' }}>
          <b>This rule will win where it overlaps {overrides.length === 1 ? 'a rule that says' : `${overrides.length} rules that say`} otherwise.</b> Where rules disagree, your latest change wins, and saving makes this one the latest:
          <ul className="olap">
            {overrides.map((r) => {
              const n = sharedFlows(r)
              return <li key={r.id}><Link to={`/rules/${encodeURIComponent(r.id)}`}>{r.title}</Link>{devices && <span> · {n ? `${plural(n, 'data flow')} on your devices` : 'none of your devices yet'}</span>}</li>
            })}
          </ul>
          {overrides.length === 1 ? 'That rule still decides' : 'Those rules still decide'} everything else {overrides.length === 1 ? 'it covers' : 'they cover'}. Changing {overrides.length === 1 ? 'it' : 'one of them'} later makes {overrides.length === 1 ? 'it' : 'that one'} the latest again.
        </div>
      )}
      {rule && rule.origin.kind !== 'custom' && (
        <Footnote>
          {rule.origin.kind === 'answer' ? 'This rule comes from your answer to one of the questions.' : 'This rule comes from the questions: households that answered like you chose it.'}
          {' '}Your changes are kept until you answer the questions again, which rebuilds your rules.
        </Footnote>
      )}

      {rule && (
        <>
          <div className="gap" />
          {confirmDelete && (gap?.flows ? gapText('Deleting this rule') : (
            <div className="info" role="status" style={{ margin: '0 16px 12px' }}>Other rules still cover everything this rule covers, so nothing is left without a rule.</div>
          ))}
          {confirmDelete && <div style={{ height: 12, flex: 'none' }} />}
          <Group>
            <Cell className="t" onClick={remove} chevron={false}>
              <div className="cb"><span className="ttl" style={{ color: '#B3261E' }}>{confirmDelete ? (gap?.flows ? 'Delete anyway' : 'Tap again to delete this rule') : 'Delete rule'}</span></div>
            </Cell>
          </Group>
        </>
      )}

      <div className="spacer" />
      <ActionBar>
        <button className="btn2" onClick={() => nav('/rules')}>Cancel</button>
        <button className="btn" onClick={save}>Save</button>
      </ActionBar>
    </div>
  )
}
