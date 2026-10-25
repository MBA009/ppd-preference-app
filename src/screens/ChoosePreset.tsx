import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Answers } from '../api'
import { ActionBar, AppBar, ErrorBox, Footnote, Group, Loading } from '../components/ui'
import { PresetSummary } from '../components/PresetSummary'
import { useHousehold, useHouseholdPresets } from '../state/data'

/**
 * The order presets are listed in: strictest first, by how much of all data flows each allows (its description
 * in household-presets.json). Fixed here for display; the presets themselves are unchanged.
 */
const ORDER = ['k8-p0', 'k8-p7', 'k8-p1', 'k8-p2', 'k8-p6', 'k8-p3', 'k8-p5', 'k8-p4']
const rank = (id: string) => (ORDER.indexOf(id) + 1 || ORDER.length + 1)

/** Every household preset, to pick one directly instead of (or after) answering the questions. */
export default function ChoosePreset() {
  const nav = useNavigate()
  const { state } = useLocation() as { state: { answers?: Answers } | null }
  const { household, choosePreset } = useHousehold()
  const { data: presets, error } = useHouseholdPresets()
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (error) return <><AppBar title="Presets" back={true} /><ErrorBox error={error} /></>
  if (!presets || !household) return <><AppBar title="Presets" back={true} /><Loading /></>

  const current = picked ?? household.preset_id
  const preset = presets.find((p) => p.id === current)
  const custom = household.rules.filter((r) => r.origin.kind === 'custom').length

  const use = async () => {
    if (!preset) return
    setSaving(true)
    // Answers from a walk just finished are kept with the choice; otherwise the stored ones stay.
    await choosePreset({ preset_id: preset.id, answers: state?.answers })
    nav('/rules?new=1', { replace: true })
  }

  return (
    <div className="screen">
      <AppBar title="Presets" back={true} />
      <div className="sf" style={{ paddingTop: 0 }}>Each preset is a short set of rules for one kind of household, from the strictest to the most open. Pick the one that fits yours.</div>
      <Group>
        <div role="radiogroup" aria-label="Presets">
          {[...presets].sort((a, b) => rank(a.id) - rank(b.id)).map((p) => (
            <button key={p.id} className="cell" role="radio" aria-checked={current === p.id} onClick={() => setPicked(p.id)}>
              <span className={'rd' + (current === p.id ? ' on' : '')} />
              <div className="cb" style={{ padding: '11px 0' }}>
                <span className="ttl">{p.name}</span>
                {p.id === household.preset_id && <span className="sub">Your preset now</span>}
              </div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>
      {preset && (
        <>
          <div className="gap" />
          <PresetSummary key={preset.id} preset={preset} />
        </>
      )}
      <Footnote>Choosing a preset replaces the rules from your previous preset{custom ? `. The ${custom === 1 ? 'rule' : `${custom} rules`} you added stay` : ''}.</Footnote>
      <div className="spacer" />
      <ActionBar>
        <button className="btn2" onClick={() => nav(-1)}>Cancel</button>
        <button className="btn" disabled={!preset || saving || (preset.id === household.preset_id && !state?.answers)} onClick={use}>Use this preset</button>
      </ActionBar>
    </div>
  )
}
