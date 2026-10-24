import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Rule } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader, Segmented, Tile } from '../components/ui'
import { ChevronDown, Icon, ShieldCheck } from '../components/icons'
import { useDevices, useHousehold, useHouseholdPresets, useRules } from '../state/data'
import { ruleCovers } from '../policy/scope'
import { CONDITION_TEXT, kindOf, type RuleKind } from '../policy/choices'
import { plural } from '../lib/verdicts'
import Onboarding from './Onboarding'
import { KIND } from '../components/PresetSummary'
import { PublishCard, PublishedRules } from '../components/Publish'

/**
 * The household policy page. On first launch (no preset yet) it asks the onboarding questions;
 * afterwards it lists the household's rules (its preset's, then its own), grouped by what they do.
 */
export default function Rules() {
  const { household } = useHousehold()
  if (!household) return <><AppBar title="Household rules" /><Loading /></>
  if (!household.preset_id) return <Onboarding />
  return <Policy />
}

const GROUPS: { kind: RuleKind; blurb: string }[] = [
  { kind: 'never', blurb: 'A device that does this conflicts with your rules, and is told no.' },
  { kind: 'limited', blurb: 'A device that does this is told the condition, and matches with limits.' },
  { kind: 'allow', blurb: 'A device that does this matches your rules.' },
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
  const { household, saveProfile, resetDemo, toast } = useHousehold()
  const [confirmReset, setConfirmReset] = useState(false)
  const [open, setOpen] = useState<Partial<Record<RuleKind, boolean>>>({})
  const { data: presets, error } = useHouseholdPresets()
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
        const n = d.flows.filter((f) => ruleCovers({ ...r, enabled: true }, f.taxonomy)).length
        flows += n
        if (n) ds += 1
      }
      out[r.id] = { flows, devices: ds }
    }
    return out
  }, [rules, devices])

  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!household || !presets) return <><AppBar title="Household rules" /><Loading /></>

  const profile = household.profile ?? { summary_frequency: 'monthly' as const, warn_on_conflict: true }
  const preset = presets.find((p) => p.id === household.preset_id)
  const made = rules.filter((r) => r.origin.kind === 'preset').length
  const added = rules.length - made

  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return }
    await resetDemo('seed')
    toast('Everything was reset')
    nav('/rules', { replace: true })
  }

  const setProfile = (patch: Partial<typeof profile>) => void saveProfile({ ...profile, ...patch })

  // The group already says Never / Allowed, so a title's own "Never:" or "Allow only if …:" is left out.
  const shortTitle = (r: Rule) => r.title.replace(/^(Never|Allow(?: only if [^:]*)?):\s*/, '')
  const used = (r: Rule) => impact[r.id]?.flows ?? 0

  const row = (r: Rule) => {
    const i = impact[r.id]
    return (
      <Cell key={r.id} to={`/rules/${encodeURIComponent(r.id)}`} className={r.enabled ? '' : 'dim'}>
        <div className="cb">
          <span className="ttl" style={{ fontSize: 15, lineHeight: '20px' }}>{shortTitle(r)}</span>
          <span className="sub">
            {r.condition && `Only if ${CONDITION_TEXT[r.condition]} · `}
            {r.origin.kind === 'preset' ? 'Preset' : 'Added by you'}
            {devices && ` · ${i && i.flows ? `${plural(i.flows, 'data flow')} on ${plural(i.devices, 'device')}` : 'not used by your devices yet'}`}
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
              <span className="sub">{preset?.name ?? 'Your preset'} gave you {plural(made, 'rule')}. Look them over. Tap any rule to change it, switch it off, or add your own.</span>
            </div>
          </Cell>
        </Group>
      )}

      {!isNew && (
        <>
          <PublishCard />
          <div className="sf" style={{ paddingTop: 0 }}>
            Every device is checked against these rules. If two rules disagree, the stricter one wins.
          </div>
        </>
      )}

      {preset && (
        <Group style={{ marginBottom: 4 }}>
          <Cell className="t" to="/rules/presets">
            <div className="cb"><span className="sub">Your preset</span><span className="ttl" style={{ fontWeight: 500 }}>{preset.name}</span></div>
          </Cell>
        </Group>
      )}

      {GROUPS.map((g) => {
        // Rules your devices use first; the rest are kept for devices that may join.
        const list = rules.filter((r) => kindOf(r) === g.kind).sort((a, b) => Number(used(b) > 0) - Number(used(a) > 0))
        if (!list.length) return null
        const k = KIND[g.kind]
        const inUse = list.filter((r) => used(r) > 0).length
        const isOpen = !!open[g.kind]
        return (
          <div key={g.kind}>
            <Group style={{ marginTop: 8 }}>
              <button className="cell" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.kind]: !isOpen }))}>
                <div className="cb" style={{ padding: '10px 0' }}>
                  <span className="ttl" style={{ fontWeight: 500 }}><span style={{ color: k.color }}>{g.kind === 'limited' ? 'Allowed with a condition' : k.title}</span> · {list.length}</span>
                  <span className="sub">{devices ? (inUse ? `${plural(inUse, 'rule')} used by your devices` : 'None used by your devices yet') : g.blurb}</span>
                </div>
                <span className="tr"><ChevronDown up={isOpen} /></span>
              </button>
              {isOpen && list.map(row)}
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

      <SectionHeader>Your preset</SectionHeader>
      <Group>
        <Cell className="t" to="/rules/update">
          <div className="cb"><span className="ttl">Answer the questions again</span><span className="sub">Rules from your preset are replaced. {added ? `The ${plural(added, 'rule')} you added stay.` : 'Rules you add yourself stay.'}</span></div>
        </Cell>
        <Cell className="t" to="/rules/presets">
          <div className="cb"><span className="ttl">Choose a different preset</span><span className="sub">{plural(presets.length, 'preset')} to pick from</span></div>
        </Cell>
        <Cell className="t" to="/rules/sources">
          <div className="cb"><span className="ttl">How the presets were made</span><span className="sub">Synthetic households from published studies</span></div>
        </Cell>
      </Group>

      <div className="gap" />
      <Group>
        <Cell className="t" chevron={false} onClick={reset}>
          <div className="cb">
            <span className="ttl" style={{ color: '#B3261E' }}>{confirmReset ? 'Tap again to reset everything' : 'Reset everything'}</span>
            <span className="sub">Clears your preset, answers and rules, including rules you added, and starts again with the questions. Connected devices stay.</span>
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
