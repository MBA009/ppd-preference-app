import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Household, Onboarding as Tree } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, Tile } from '../components/ui'
import { Icon, ShieldCheck } from '../components/icons'
import { useHousehold, useLibrary, useOnboarding } from '../state/data'
import { questionText, refineQueue, writeAnswer, type RefineItem } from '../../shared/onboarding'
import { plural } from '../lib/verdicts'
import { timeAgo } from '../lib/device'
import { ownedClasses } from './Onboarding'

/**
 * "Help me refine my settings" (Nov 2 meeting): an open-ended queue instead of a fixed list of follow-ups.
 *
 * - situations no rule decides any more come first (the household deleted that rule: no preference yet);
 * - then the situations households like this one are split on, most unsure first, then the rest it was never asked;
 * - then a check-up of earlier answers, oldest first.
 *
 * Each answer is saved at once and changes only its own situation: other rules and the person's edits stay. The screen
 * says when the rules are a good picture, offers a break every BREAK_EVERY answers, and the household can stop or go on
 * at any time.
 */
const BREAK_EVERY = 10

export default function Refine() {
  const tree = useOnboarding()
  const library = useLibrary()
  const { household } = useHousehold()
  if (tree.error) return <><AppBar title="Refine your settings" back="/rules" /><ErrorBox error={tree.error} /></>
  if (!tree.data || !household || (!library.data && !library.error)) return <><AppBar title="Refine your settings" back="/rules" /><Loading /></>
  return <Queue tree={tree.data} household={household} owned={ownedClasses(household, library.data ?? [])} />
}

type Pause = 'break' | 'good' | null

function Queue({ tree, household, owned }: { tree: Tree; household: Household; owned: string[] }) {
  const nav = useNavigate()
  const { answerQuestion } = useHousehold()
  const [started, setStarted] = useState(false)
  // Asked in this sitting: not asked again, even if the answer was "Not sure" and left the situation undecided.
  const [session, setSession] = useState<string[]>([])
  const [pick, setPick] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pause, setPause] = useState<Pause>(null)
  const [goodAtStart] = useState(() => refineQueue(tree, household).goodPicture)
  const [goodSeen, setGoodSeen] = useState(false)

  const queue = refineQueue(tree, household)
  if (!started) return <Start tree={tree} household={household} onStart={() => setStarted(true)} />

  const done = () => nav('/rules')
  const next = queue.items.find((i) => !session.includes(i.question))

  if (pause === 'break') {
    return (
      <Notice
        tone="blue" icon={<ShieldCheck />} title="Take a break?"
        text={`You've answered ${plural(session.length, 'question')}. Your answers are saved and your rules already use them. Come back to "Help me refine my settings" any time to carry on.`}
        stop="Take a break" go="Keep going" onStop={done} onGo={() => setPause(null)}
      />
    )
  }
  if (pause === 'good') {
    return (
      <Notice
        tone="green" icon={<Icon name="check" size={20} />} title="We have a good picture of what you want"
        text="Households like yours agree on every situation left, so your rules already match them. You can stop here, or keep going through the rest and check your earlier answers."
        stop="Done" go="Keep going" onStop={done} onGo={() => { setGoodSeen(true); setPause(null) }}
      />
    )
  }
  if (!next) {
    return (
      <Notice
        tone="green" icon={<Icon name="check" size={20} />} title="You've gone through every situation"
        text="Every situation we ask about now has your own answer. Come back now and then for a check-up of your earlier answers."
        stop={null} go="Done" onStop={done} onGo={done}
      />
    )
  }

  const q = tree.questions[next.question]
  const previous = household.answers?.[next.question] ?? null
  const chosen = pick ?? (next.reason === 'checkup' ? previous : null)
  const remaining = queue.undecided + queue.split
  const { text, example } = questionText(q, owned)

  const answer = async () => {
    if (!chosen) return
    setSaving(true)
    await answerQuestion({ question: next.question, answer: chosen })
    setSaving(false)
    const asked = [...session, next.question]
    setSession(asked); setPick(null); window.scrollTo(0, 0)
    const after = refineQueue(tree, { ...household, answers: { ...household.answers, [next.question]: chosen }, rules: writeAnswer(household.rules, next.question, chosen, tree.questions) })
    if (!goodAtStart && !goodSeen && after.goodPicture) setPause('good')
    else if (asked.length % BREAK_EVERY === 0) setPause('break')
  }

  return (
    <div className="screen">
      <AppBar
        title="Refine your settings" back="/rules"
        subtitle={queue.goodPicture ? `${plural(session.length, 'answer')} so far · good picture` : `${plural(remaining, 'situation')} left to settle`}
      />
      {!queue.goodPicture && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={session.length + remaining} aria-valuenow={session.length}>
          <i style={{ width: `${(session.length / Math.max(1, session.length + remaining)) * 100}%` }} />
        </div>
      )}
      <div className="q">
        <h2>{text}</h2>
        {example && <p className="eg">For example, {example}.</p>}
      </div>
      <div style={{ height: 12, flex: 'none' }} />
      <Group>
        <div role="radiogroup" aria-label={text}>
          {q.options.map((o) => (
            <button key={o.id} className="cell" role="radio" aria-checked={chosen === o.id} onClick={() => setPick(o.id)}>
              <span className={'rd' + (chosen === o.id ? ' on' : '')} />
              <div className="cb" style={{ padding: '13px 0' }}><span className="ttl">{o.label}</span></div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>
      <Footnote>{reasonText(next, household)} <Link to="/rules/sources">How the questions were made</Link></Footnote>
      <div className="spacer" />
      <ActionBar>
        <button className="btn2" onClick={done}>Stop for now</button>
        <button className="btn" disabled={!chosen || saving} onClick={answer}>Next</button>
      </ActionBar>
    </div>
  )
}

/** Before the first question: where the household stands, and that answers only change their own situation. */
function Start({ tree, household, onStart }: { tree: Tree; household: Household; onStart: () => void }) {
  const nav = useNavigate()
  const queue = refineQueue(tree, household)
  const checked = Object.values(household.answered_at ?? {}).sort().pop()
  const where = queue.undecided
    ? `${plural(queue.undecided, 'situation has', 'situations have')} no rule since you removed one, so we'll ask about ${queue.undecided === 1 ? 'it' : 'those'} first. `
    : ''
  const status = queue.goodPicture
    ? 'We have a good picture of what you want: households like yours agree on every situation left. You can still go through more, or check your earlier answers.'
    : `${where}${queue.split ? `Households like yours are split on ${plural(queue.split, 'situation')}. We ask about them one at a time, the least certain first.` : ''}`
  return (
    <div className="screen">
      <AppBar title="Refine your settings" back="/rules" />
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={queue.goodPicture ? 'green' : 'blue'} style={{ marginTop: 10 }}><ShieldCheck /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>Help me refine my settings</span>
            <span className="sub">{status}</span>
          </div>
        </Cell>
      </Group>
      <Footnote>
        Each answer changes only that situation: your other rules and the changes you made stay. Your answers are saved as
        you go, so stop whenever you like.{checked ? ` Last answer ${timeAgo(checked)}.` : ''}
      </Footnote>
      <div className="spacer" />
      <ActionBar>
        <button className="btn2" onClick={() => nav('/rules')}>Cancel</button>
        <button className="btn" onClick={onStart}>{queue.goodPicture ? 'Keep going' : 'Start'}</button>
      </ActionBar>
    </div>
  )
}

function Notice({ tone, icon, title, text, stop, go, onStop, onGo }: {
  tone: 'blue' | 'green'; icon: JSX.Element; title: string; text: string; stop: string | null; go: string; onStop: () => void; onGo: () => void
}) {
  return (
    <div className="screen">
      <AppBar title="Refine your settings" back="/rules" />
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={tone} style={{ marginTop: 10 }}>{icon}</Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{title}</span>
            <span className="sub">{text}</span>
          </div>
        </Cell>
      </Group>
      <div className="spacer" />
      <ActionBar>
        {stop && <button className="btn2" onClick={onStop}>{stop}</button>}
        <button className="btn" onClick={onGo}>{go}</button>
      </ActionBar>
    </div>
  )
}

const reasonText = (item: RefineItem, h: Household): string => {
  switch (item.reason) {
    case 'undecided': return 'No rule decides this since you removed one, so your devices get no rule for it.'
    case 'split': return 'Households like yours are split on this, so we ask instead of guessing.'
    case 'likely': return 'Most households like yours agree on this. Tell us if you don’t.'
    case 'checkup': {
      const at = h.answered_at?.[item.question]
      return `You answered this${at ? ` ${timeAgo(at)}` : ' before'}. Is it still right?`
    }
  }
}
