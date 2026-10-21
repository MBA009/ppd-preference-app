import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Rule, RuleEffect, RuleScope } from '../api'
import { ActionBar, AppBar, Cell, Footnote, Group, Loading, Pill, SectionHeader, Switch } from '../components/ui'
import { useDevices, useHousehold } from '../state/data'
import { matchesScope } from '../policy/scope'
import { ACTION_CHOICES, DATA_CHOICES, EFFECT_LABEL, KEPT_FOREVER, PURPOSE_CHOICES, WHO_CHOICES, autoTitle, isOn, toggle, type Choice } from '../policy/choices'
import { plural } from '../lib/verdicts'

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
        <div className="empty">That rule is gone. <Link to="/rules" className="link">Back to your rules</Link></div>
      </div>
    )
  }
  return <Editor key={existing?.id ?? 'new'} rule={existing} />
}

const EFFECTS: { effect: RuleEffect; label: string; sub: string }[] = [
  { effect: 'dont_allow', label: EFFECT_LABEL.dont_allow, sub: 'A device that does this conflicts with your rules.' },
  { effect: 'ask', label: EFFECT_LABEL.ask, sub: 'A device that does this waits for your decision.' },
  { effect: 'allow', label: EFFECT_LABEL.allow, sub: 'A device that does this matches your rules.' },
]

function Editor({ rule }: { rule: Rule | undefined }) {
  const nav = useNavigate()
  const { household, upsertRule, deleteRule, toast } = useHousehold()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)

  const [title, setTitle] = useState(rule?.title ?? '')
  const [effect, setEffect] = useState<RuleEffect>(rule?.effect ?? 'ask')
  const [scope, setScope] = useState<RuleScope>(rule?.scope ?? {})
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const forever = !!scope.constraints?.includes(KEPT_FOREVER)
  const empty = !scope.data_type?.length && !scope.purpose?.length && !scope.handling_context?.length && !scope.action?.length && !scope.constraints?.length
  const shownTitle = title.trim() || autoTitle(effect, scope)

  const impact = useMemo(() => {
    let flows = 0
    let ds = 0
    for (const d of devices ?? []) {
      const n = d.flows.filter((f) => matchesScope(f, scope)).length
      flows += n
      if (n) ds += 1
    }
    return { flows, devices: ds }
  }, [devices, scope])

  const flip = (key: 'data_type' | 'purpose' | 'handling_context' | 'action', c: Choice) =>
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
      title: shownTitle,
      effect,
      scope,
      enabled,
      origin: rule?.origin ?? { kind: 'custom' },
    }
    await upsertRule(next)
    toast(rule ? 'Rule saved.' : 'Rule added.')
    nav('/rules', { replace: true })
  }

  const remove = async () => {
    if (!rule) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    await deleteRule(rule.id)
    toast('Rule deleted.')
    nav('/rules', { replace: true })
  }

  const group = (heading: string, hint: string, key: 'data_type' | 'purpose' | 'handling_context' | 'action', choices: Choice[]) => (
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

      <SectionHeader>What should happen</SectionHeader>
      <Group>
        <div role="radiogroup" aria-label="What should happen">
          {EFFECTS.map((e) => (
            <button key={e.effect} className="cell" role="radio" aria-checked={effect === e.effect} onClick={() => setEffect(e.effect)}>
              <span className={'rd' + (effect === e.effect ? ' on' : '')} />
              <div className="cb"><span className="ttl">{e.label}</span><span className="sub">{e.sub}</span></div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>

      <div style={{ height: 8, flex: 'none' }} />
      {group('When a device handles this data', 'Pick any. Leave all unpicked to cover every kind of data.', 'data_type', DATA_CHOICES)}
      {group('For this reason', 'Leave all unpicked to cover every reason.', 'purpose', PURPOSE_CHOICES)}
      {group('Handled by', 'Leave all unpicked to cover everyone. “Other companies” means anyone besides the maker and its services.', 'handling_context', WHO_CHOICES)}
      {group('What happens to it', 'Leave all unpicked to cover every kind of handling.', 'action', ACTION_CHOICES)}

      <SectionHeader>Only if</SectionHeader>
      <div className="pills">
        <Pill on={forever} onClick={() => setForever(!forever)}>The device says it keeps the data forever</Pill>
      </div>
      <div className="sf" style={{ paddingTop: 0, marginTop: -6 }}>We can only check this when a device states how long it keeps data. “Not stated” is never treated as forever.</div>

      <SectionHeader>Rule name</SectionHeader>
      <Group>
        <textarea className="fld" rows={2} aria-label="Rule name" value={title} placeholder={autoTitle(effect, scope)} onChange={(e) => setTitle(e.target.value)} />
      </Group>

      <div style={{ height: 12, flex: 'none' }} />
      <Group>
        <div className="cell">
          <div className="cb"><span className="ttl">Rule is on</span><span className="sub">Switch off to keep the rule but ignore it.</span></div>
          <Switch on={enabled} onChange={setEnabled} label="Rule is on" />
        </div>
      </Group>

      <div className={empty ? 'note' : 'info'} role="status" style={empty ? { margin: '12px 16px 0' } : undefined}>
        {empty
          ? 'Nothing is picked, so this rule would cover every data flow. Pick at least one thing above to narrow it.'
          : !devices
            ? 'Checking your devices…'
            : impact.flows
              ? `This rule covers ${plural(impact.flows, 'data flow')} on ${plural(impact.devices, 'device')} in your home.`
              : 'No device in your home does this right now. The rule will apply when one does.'}
      </div>
      {rule && rule.origin.kind === 'questionnaire' && (
        <Footnote>This rule was made from your answers. Your changes are kept until you answer the questions again.</Footnote>
      )}

      {rule && (
        <>
          <div className="gap" />
          <Group>
            <Cell className="t" onClick={remove} chevron={false}>
              <div className="cb"><span className="ttl" style={{ color: '#B3261E' }}>{confirmDelete ? 'Tap again to delete this rule' : 'Delete rule'}</span></div>
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
