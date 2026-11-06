import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Rule, Taxonomy } from '../api'
import { ActionBar, AppBar, Cell, Footnote, Group, Loading, SectionHeader, Tile } from '../components/ui'
import { Icon } from '../components/icons'
import { useDevices, useHousehold } from '../state/data'
import { gapScopes, undecidedFlows } from '../policy/scope'
import { ruleTitle } from '../../shared/ruleTitle'
import { plural } from '../lib/verdicts'

/**
 * Data flows no rule decides, after a rule was deleted or switched off (/rules/settle). Grouped by situation (data type
 * × purpose × where it goes, 28 flows each), each answered with Never or Allow like a single flow on a device's page:
 * one answer writes one rule for the whole situation. This reaches every situation, including the many the refine
 * questions don't ask about.
 */
interface Gap { key: string; scope: Pick<Rule['scope'], 'data_type' | 'purpose' | 'handling_context'>; flows: Taxonomy[]; devices: string[] }

/** All of a situation is 4 actions × 7 sources. */
const SITUATION_FLOWS = 28

const situationKey = (t: Pick<Taxonomy, 'data_type' | 'purpose' | 'handling_context'>) => `${t.data_type}|${t.purpose}|${t.handling_context}`

/** The situation in the rules' own words: the rule name without its "Allow:". */
const situationText = (scope: Gap['scope']) => {
  const text = ruleTitle({ effect: 'allow', condition: null, scope }).replace(/^Allow: /, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export default function Settle() {
  const nav = useNavigate()
  const { household, upsertRule, toast } = useHousehold()
  const ids = (household?.devices ?? []).map((d) => d.device_id)
  const { data: devices } = useDevices(ids)
  const [busy, setBusy] = useState<string | null>(null)
  const rules = household?.rules

  const gaps = useMemo<Gap[]>(() => {
    if (!rules) return []
    const out = new Map<string, Gap>()
    for (const t of undecidedFlows(rules)) {
      const key = situationKey(t)
      const g = out.get(key) ?? { key, scope: { data_type: [t.data_type], purpose: [t.purpose], handling_context: [t.handling_context] }, flows: [], devices: [] }
      g.flows.push(t)
      out.set(key, g)
    }
    for (const d of devices ?? []) {
      for (const f of d.flows) {
        const g = f.evaluation.verdict === 'decision_required' ? out.get(situationKey(f.taxonomy)) : undefined
        if (g && !g.devices.includes(d.short_name)) g.devices.push(d.short_name)
      }
    }
    // What the devices in the home do first: that needs deciding now.
    return [...out.values()].sort((a, b) => b.devices.length - a.devices.length)
  }, [rules, devices])

  if (!household) return <><AppBar title="Data flows with no rule" back="/rules" /><Loading /></>

  const answer = async (g: Gap, effect: Rule['effect']) => {
    setBusy(g.key)
    const n = g.flows.length
    try {
      for (const [i, scope] of gapScopes(g.scope, g.flows).entries()) {
        const draft: Rule = { id: `custom.${Date.now().toString(36)}.${i}`, title: '', effect, condition: null, enabled: true, origin: { kind: 'custom' }, scope }
        await upsertRule({ ...draft, title: ruleTitle(draft) })
      }
      toast(`${effect === 'allow' ? 'Allowed' : 'Never'}. ${plural(n, 'data flow')} now ${n === 1 ? 'has' : 'have'} a rule.`)
    } finally {
      setBusy(null)
    }
  }

  if (!gaps.length) {
    return (
      <div className="screen">
        <AppBar title="Data flows with no rule" back="/rules" />
        <Group>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="green" style={{ marginTop: 10 }}><Icon name="check" size={20} /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>Every data flow has a rule</span>
              <span className="sub">Your household policy decides every kind of data flow again, so your devices get a rule for each.</span>
            </div>
          </Cell>
        </Group>
        <div className="spacer" />
        <ActionBar><button className="btn" onClick={() => nav('/rules')}>Done</button></ActionBar>
      </div>
    )
  }

  const total = gaps.reduce((n, g) => n + g.flows.length, 0)
  return (
    <div className="screen">
      <AppBar title="Data flows with no rule" back="/rules" />
      <div className="sf">
        A rule was deleted or switched off, so {plural(total, 'data flow has', 'data flows have')} no rule and your devices get no rule
        for {total === 1 ? 'it' : 'them'}. Decide each situation below: your answer is saved as one rule for all of it.
      </div>
      {gaps.map((g) => <GapCard key={g.key} gap={g} busy={busy === g.key} onAnswer={(e) => answer(g, e)} />)}
      <Footnote>
        Want a condition, such as only if it is processed in your home? <Link to="/rules/new">Add a rule</Link> instead.
      </Footnote>
      <div className="spacer" />
    </div>
  )
}

function GapCard({ gap: g, busy, onAnswer }: { gap: Gap; busy: boolean; onAnswer: (effect: Rule['effect']) => void }) {
  return (
    <>
      <SectionHeader>{g.devices.length ? `On your devices · ${g.devices.join(', ')}` : 'None of your devices does this yet'}</SectionHeader>
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={g.devices.length ? 'orange' : 'blue'} style={{ marginTop: 10 }}><Icon name="status" size={18} /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{situationText(g.scope)}</span>
            <span className="sub">{g.flows.length === SITUATION_FLOWS ? `${SITUATION_FLOWS} data flows with no rule: every way this data can be handled and where it comes from.` : `${g.flows.length} of its ${SITUATION_FLOWS} data flows have no rule; other rules decide the rest, and stay.`}</span>
          </div>
        </Cell>
        <div className="cell" style={{ gap: 8, padding: '4px 16px 14px' }}>
          <button className="btn2" style={{ flex: 1 }} disabled={busy} onClick={() => onAnswer('dont_allow')}>Never</button>
          <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => onAnswer('allow')}>Allow</button>
        </div>
      </Group>
    </>
  )
}

