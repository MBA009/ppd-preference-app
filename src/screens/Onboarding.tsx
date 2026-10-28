import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Answers, HouseholdPreset, Onboarding as Tree } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, Tile } from '../components/ui'
import { ShieldCheck } from '../components/icons'
import { useHousehold, useHouseholdPresets, useLibrary, useOnboarding } from '../state/data'
import { CATEGORY_CLASS, followUps, promptFor, questionText, rulesFromAnswers, situationAnswers, stageOnePath, walk } from '../../shared/onboarding'
import { plural } from '../lib/verdicts'

/**
 * The questionnaire, one situation per screen, at most `total_questions_cap` in all:
 *
 * - stage 1 walks a decision tree to one of the household presets (never shown: the household does not pick one);
 * - stage 2 ("help me refine my settings") asks the situations households like this one are split on;
 * - the answers are written into the preset's rules, and those become the household's rules.
 *
 * `first` runs at first launch, `retake` starts over from the first question, `refine` keeps stage 1 and asks the
 * follow-ups again (a privacy checkup). Every run rebuilds the rules (start over), after saying so.
 */
type Mode = 'first' | 'retake' | 'refine'

export default function Onboarding({ mode = 'first' }: { mode?: Mode }) {
  const tree = useOnboarding()
  const presets = useHouseholdPresets()
  const library = useLibrary()
  const { household } = useHousehold()
  const error = tree.error ?? presets.error
  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!tree.data || !presets.data || !household || (!library.data && !library.error)) return <><AppBar title="Household rules" /><Loading /></>
  // Example wording follows the device classes the household owns (the library knows each device's category).
  const owned = household.devices
    .map((d) => library.data?.find((x) => x.id === d.device_id)?.category)
    .map((c) => (c ? CATEGORY_CLASS[c] : undefined))
    .filter((c): c is string => !!c)
  return <Walk tree={tree.data} presets={presets.data} mode={mode} owned={[...new Set(owned)]} />
}

const INTRO = '__intro'   // the stage 2 introduction, in the back stack like a question

function Walk({ tree, presets, mode, owned }: { tree: Tree; presets: HouseholdPreset[]; mode: Mode; owned: string[] }) {
  const nav = useNavigate()
  const { household, finishOnboarding } = useHousehold()
  const before = household?.answers ?? {}
  const cap = tree.source.total_questions_cap

  // A checkup keeps stage 1's answers and asks the follow-ups again; other runs start empty. Earlier answers are
  // offered as the starting choice either way.
  const initial = useMemo<Answers>(() => {
    if (mode !== 'refine') return {}
    const path = stageOnePath(tree, before)
    return Object.fromEntries(path.filter((q) => q in before).map((q) => [q, before[q]]))
  }, [mode, tree, before])
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<Answers>(initial)
  const [order, setOrder] = useState<string[]>(mode === 'refine' ? [INTRO] : [])
  const [pick, setPick] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const go = (next: Answers, nextOrder: string[], nextPick: string | null) => {
    setAnswers(next); setOrder(nextOrder); setPick(nextPick); window.scrollTo(0, 0)
  }
  const back = () => {
    const last = order[order.length - 1]
    if (!last || (mode === 'refine' && order.length === 1)) { setStarted(false); return }
    if (last === INTRO) { go(answers, order.slice(0, -1), null); return }
    const { [last]: previous, ...rest } = answers
    go(rest, order.slice(0, -1), previous)
  }

  if (!started) return <Start tree={tree} mode={mode} onStart={() => setStarted(true)} />

  const step = walk(tree, answers)
  const asked = order.filter((q) => q !== INTRO).length
  const question = (qid: string, stage: 1 | 2, total: number) => {
    const q = tree.questions[qid]
    const chosen = pick ?? before[qid] ?? null
    const n = asked + 1
    const answer = () => chosen && go({ ...answers, [qid]: chosen }, [...order, qid], null)
    const prompt = promptFor(q, owned)
    const { text, example } = questionText(q, owned)
    return (
      <div className="screen">
        <AppBar title={stage === 1 ? 'Household rules' : 'The details'} subtitle={`Question ${n} of up to ${total}`} back={back} />
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={n}><i style={{ width: `${(n / total) * 100}%` }} /></div>
        <div className="q">
          <h2>{text}</h2>
          {example && <p className="eg">For example, {example}.</p>}
        </div>
        <div style={{ height: 12, flex: 'none' }} />
        <Group>
          <div role="radiogroup" aria-label={prompt}>
            {q.options.map((o) => (
              <button key={o.id} className="cell" role="radio" aria-checked={chosen === o.id} onClick={() => setPick(o.id)}>
                <span className={'rd' + (chosen === o.id ? ' on' : '')} />
                <div className="cb" style={{ padding: '13px 0' }}><span className="ttl">{o.label}</span></div>
                <span className="tr" />
              </button>
            ))}
          </div>
        </Group>
        <Footnote>
          {stage === 2 ? 'Households like yours are split on this, so we ask instead of guessing. ' : ''}
          <Link to="/rules/sources">How the questions were made</Link>
        </Footnote>
        <div className="spacer" />
        <ActionBar>
          <button className="btn2" onClick={back}>Back</button>
          <button className="btn" disabled={!chosen} onClick={answer}>Next</button>
        </ActionBar>
      </div>
    )
  }

  // Stage 1: the tree.
  if ('question' in step) return question(step.question, 1, cap)

  // Stage 2: the leaf's follow-ups, after a short introduction.
  const leaf = step.leaf
  const pending = followUps(tree, leaf, answers)
  const stage2Total = stageOnePath(tree, answers).length + pending.length
  if (pending.length && !order.includes(INTRO)) {
    return (
      <div className="screen">
        <AppBar title="The details" back={back} />
        <Group>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="blue" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>{tree.follow_up_intro.title}</span>
              <span className="sub">{tree.follow_up_intro.text} {plural(pending.length, 'more question')}.</span>
            </div>
          </Cell>
        </Group>
        <div className="spacer" />
        <ActionBar>
          <button className="btn2" onClick={back}>Back</button>
          <button className="btn" onClick={() => go(answers, [...order, INTRO], null)}>Continue</button>
        </ActionBar>
      </div>
    )
  }
  const next = pending.find((q) => !(q in answers))
  if (next) return question(next, 2, mode === 'refine' ? pending.length : stage2Total)

  // Done: the household's rules, from the preset with the answers written in.
  const preset = presets.find((p) => p.id === leaf.preset)
  if (!preset) return <><AppBar title="Your rules" back={back} /><ErrorBox error={new Error(`The questions led to a preset this app does not have (${leaf.preset}).`)} /></>
  const rules = rulesFromAnswers(preset, situationAnswers(tree, answers), tree.questions)
  const fromAnswers = rules.filter((r) => r.origin.kind === 'answer').length
  const replacing = mode !== 'first' && !!household?.rules.length
  const finish = async () => {
    setSaving(true)
    await finishOnboarding({ answers })
    nav('/rules?new=1', { replace: true })
  }
  return (
    <div className="screen">
      <AppBar title="Your rules" back={back} />
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="green" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>Your household rules are ready</span>
            <span className="sub">
              {plural(rules.length, 'rule')} from your answers, {fromAnswers ? `${fromAnswers} of them for situations you told us about directly` : 'matching households that answered like you'}.
              Every device in your home receives them, and you can change any rule afterwards.
            </span>
          </div>
        </Cell>
      </Group>
      {replacing && <Footnote>This replaces your current rules, including changes you made and rules you added.</Footnote>}
      <div className="spacer" />
      <ActionBar>
        <button className="btn2" onClick={back}>Back</button>
        <button className="btn" disabled={saving} onClick={finish}>{replacing ? 'Replace my rules' : 'Set up my rules'}</button>
      </ActionBar>
    </div>
  )
}

/** Before the first question: what is about to happen (week 9: always open with this), and what a rerun replaces. */
function Start({ tree, mode, onStart }: { tree: Tree; mode: Mode; onStart: () => void }) {
  const nav = useNavigate()
  const text = {
    first: { title: tree.splash.title, body: tree.splash.text, button: 'Start' },
    retake: { title: 'Answer the questions again', body: `${tree.splash.text} Your rules will be rebuilt from your new answers: changes you made and rules you added are replaced.`, button: 'Start again' },
    refine: { title: 'Help me refine my settings', body: `${tree.follow_up_intro.text} Your answers to the first questions stay; your rules are rebuilt from the new answers, so changes you made are replaced.`, button: 'Start' },
  }[mode]
  return (
    <div className="screen">
      <AppBar title="Household rules" back={mode === 'first' ? undefined : '/rules'} />
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="blue" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{text.title}</span>
            <span className="sub">{text.body}</span>
          </div>
        </Cell>
      </Group>
      <Footnote><Link to="/rules/sources">How the questions were made</Link></Footnote>
      <div className="spacer" />
      <ActionBar>
        {mode !== 'first' && <button className="btn2" onClick={() => nav('/rules')}>Cancel</button>}
        <button className="btn" onClick={onStart}>{text.button}</button>
      </ActionBar>
    </div>
  )
}
