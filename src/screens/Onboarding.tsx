import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Answers, HouseholdPreset, Onboarding as Tree } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, Tile } from '../components/ui'
import { ShieldCheck } from '../components/icons'
import { PresetSummary } from '../components/PresetSummary'
import { useHousehold, useHouseholdPresets, useOnboarding } from '../state/data'
import { questionsLeft, walk } from '../../shared/onboarding'

/**
 * The household onboarding: a few questions, one per screen, walk a decision tree to one of the household
 * presets. The household never decides single flows; the preset's rules do, and the person can change them.
 */
export default function Onboarding({ retake }: { retake?: boolean }) {
  const tree = useOnboarding()
  const presets = useHouseholdPresets()
  const { household } = useHousehold()
  const error = tree.error ?? presets.error
  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!tree.data || !presets.data || !household) return <><AppBar title="Household rules" /><Loading /></>
  return <Walk tree={tree.data} presets={presets.data} retake={!!retake} />
}

function Walk({ tree, presets, retake }: { tree: Tree; presets: HouseholdPreset[]; retake: boolean }) {
  const nav = useNavigate()
  const { household, choosePreset } = useHousehold()
  const before = household?.answers ?? {}
  // Only answers given on this run steer the walk; earlier ones are offered as the starting choice.
  const [answers, setAnswers] = useState<Answers>({})
  const [order, setOrder] = useState<string[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const step = walk(tree, answers)
  const firstRun = !household?.preset_id

  const go = (next: Answers, nextOrder: string[], nextPick: string | null) => {
    setAnswers(next)
    setOrder(nextOrder)
    setPick(nextPick)
    window.scrollTo(0, 0)
  }
  const back = () => {
    const last = order[order.length - 1]
    const { [last]: previous, ...rest } = answers
    go(rest, order.slice(0, -1), previous)
  }

  if ('preset' in step) {
    const preset = presets.find((p) => p.id === step.preset)
    if (!preset) return <><AppBar title="Your preset" back={back} /><ErrorBox error={new Error(`The questions led to a preset this app does not have (${step.preset}).`)} /></>
    const use = async () => {
      setSaving(true)
      await choosePreset({ preset_id: preset.id, answers })
      nav('/rules?new=1', { replace: true })
    }
    return (
      <div className="screen">
        <AppBar title="Your preset" back={back} />
        <div className="sf" style={{ paddingTop: 0 }}>From your answers, this preset fits your household best.</div>
        <PresetSummary preset={preset} />
        <Footnote>
          Your devices are checked against these rules and receive them. You can change, switch off or add rules afterwards
          {retake ? '; rules you added yourself stay' : ''}. <Link className="link" to="/rules/presets" state={{ answers }}>Choose a different preset</Link>
        </Footnote>
        <div className="spacer" />
        <ActionBar>
          <button className="btn2" onClick={back}>Back</button>
          <button className="btn" disabled={saving} onClick={use}>{household?.preset_id === preset.id ? 'Keep this preset' : 'Use this preset'}</button>
        </ActionBar>
      </div>
    )
  }

  const q = tree.questions[step.question]
  const chosen = pick ?? before[step.question] ?? null
  const n = order.length + 1
  const total = order.length + questionsLeft(tree.root, answers)
  const answer = () => chosen && go({ ...answers, [step.question]: chosen }, [...order, step.question], null)

  return (
    <div className="screen">
      <AppBar
        title="Household rules"
        subtitle={`Question ${n} of up to ${total}`}
        back={order.length ? back : retake ? '/rules' : undefined}
      />
      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={n}><i style={{ width: `${(n / total) * 100}%` }} /></div>

      {n === 1 && firstRun && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="blue" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>{tree.title}</span>
              <span className="sub">{tree.description}</span>
            </div>
          </Cell>
        </Group>
      )}

      <div className="q"><h2>{q.prompt}</h2></div>
      <div style={{ height: 12, flex: 'none' }} />
      <Group>
        <div role="radiogroup" aria-label={q.prompt}>
          {q.options.map((o) => (
            <button key={o.id} className="cell" role="radio" aria-checked={chosen === o.id} onClick={() => setPick(o.id)}>
              <span className={'rd' + (chosen === o.id ? ' on' : '')} />
              <div className="cb" style={{ padding: '13px 0' }}><span className="ttl">{o.label}</span></div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>
      <Footnote>{tree.disclaimer} <Link to="/rules/sources">How the presets were made</Link></Footnote>
      <div className="spacer" />

      <ActionBar>
        {order.length > 0 && <button className="btn2" onClick={back}>Back</button>}
        <button className="btn" disabled={!chosen} onClick={answer}>Next</button>
      </ActionBar>
    </div>
  )
}
