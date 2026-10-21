import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Answers, Profile, Question, Questionnaire as Tree } from '../api'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, Segmented, SectionHeader, Switch, Tile } from '../components/ui'
import { ChevronDown, ShieldCheck } from '../components/icons'
import { useHousehold, useQuestionnaire } from '../state/data'
import { generatePolicy, resolveAnswers, visibleQuestions } from '../policy/generate'

/** The household questions: one per screen, branching on earlier answers. The answers generate the policy. */
export default function Questionnaire({ retake }: { retake?: boolean }) {
  const { data: tree, error } = useQuestionnaire()
  const { household } = useHousehold()
  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!tree || !household) return <><AppBar title="Household rules" /><Loading /></>
  return <Steps tree={tree} retake={!!retake} />
}

function Steps({ tree, retake }: { tree: Tree; retake: boolean }) {
  const nav = useNavigate()
  const { household, savePolicy } = useHousehold()
  // `touched` holds only what the person chose. Defaults and prefills are filled in by resolveAnswers.
  const [touched, setTouched] = useState<Answers>(household?.answers ?? {})
  const [step, setStep] = useState(0)
  const [why, setWhy] = useState(false)
  const [saving, setSaving] = useState(false)

  const answers = useMemo(() => resolveAnswers(tree, touched), [tree, touched])
  const visible = useMemo(() => visibleQuestions(tree, answers), [tree, answers])
  const i = Math.min(step, visible.length - 1)
  const q = visible[i]
  const last = i === visible.length - 1
  const firstRun = !household?.answers

  const matrix = (id: string) => (answers[id] as Record<string, string>) ?? {}
  const setRow = (qid: string, row: string, value: string) => setTouched((t) => ({ ...t, [qid]: { ...(t[qid] as Record<string, string> | undefined), [row]: value } }))
  const setField = (qid: string, field: string, value: string | boolean) => setTouched((t) => ({ ...t, [qid]: { ...(t[qid] as Record<string, string | boolean> | undefined), [field]: value } }))

  const answered = q.type !== 'single' || typeof answers[q.id] === 'string'

  const finish = async () => {
    setSaving(true)
    const { rules, profile } = generatePolicy(tree, answers)
    // Rules the person added themselves survive a re-run; rules made from answers are replaced.
    const custom = (household?.rules ?? []).filter((r) => r.origin.kind === 'custom')
    await savePolicy({ answers: touched, rules: [...rules, ...custom], profile })
    nav('/rules?new=1', { replace: true })
  }

  const go = (n: number) => { setStep(n); setWhy(false); window.scrollTo(0, 0) }

  return (
    <div className="screen">
      <AppBar
        title="Household rules"
        subtitle={`Question ${i + 1} of ${visible.length}`}
        back={i > 0 ? () => go(i - 1) : retake ? '/rules' : undefined}
      />
      <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={visible.length} aria-valuenow={i + 1}><i style={{ width: `${((i + 1) / visible.length) * 100}%` }} /></div>

      {i === 0 && firstRun && (
        <Group style={{ marginBottom: 12 }}>
          <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
            <Tile tone="blue" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
            <div className="cb" style={{ paddingRight: 16 }}>
              <span className="ttl" style={{ fontWeight: 500 }}>Set up your household rules</span>
              <span className="sub">A few questions about what you are comfortable with. Your answers become rules that every device is checked against. You can look over and change each rule afterwards.</span>
            </div>
          </Cell>
        </Group>
      )}

      <div className="q">
        <h2>{q.prompt}</h2>
        <p>{q.help}</p>
      </div>
      <div style={{ height: 12, flex: 'none' }} />

      <QuestionBody q={q} answers={answers} matrix={matrix} onSingle={(v) => setTouched((t) => ({ ...t, [q.id]: v }))} onRow={setRow} onField={setField} />

      <div style={{ height: 8, flex: 'none' }} />
      <Group>
        <Cell onClick={() => setWhy(!why)} chevron={false} aria-expanded={why}>
          <div className="cb" style={{ padding: '10px 0' }}><span className="ttl" style={{ fontSize: 14, lineHeight: '20px', color: '#0066CC' }}>Why we ask</span></div>
          <span className="tr"><ChevronDown up={why} /></span>
        </Cell>
        {why && (
          <div className="why">
            {q.why}{' '}
            <span>Sources: {q.sources.map((s, n) => (
              <span key={s}>{n > 0 && '; '}<a href={tree.sources[s].url} target="_blank" rel="noreferrer">{tree.sources[s].short}</a></span>
            ))}.</span>
          </div>
        )}
      </Group>
      {i === visible.length - 1 && <Footnote>{tree.disclaimer} <Link to="/rules/sources">All sources</Link></Footnote>}
      <div className="spacer" />

      <ActionBar>
        {i > 0 && <button className="btn2" onClick={() => go(i - 1)}>Back</button>}
        <button className="btn" disabled={!answered || saving} onClick={() => (last ? finish() : go(i + 1))}>{last ? 'See my rules' : 'Next'}</button>
      </ActionBar>
    </div>
  )
}

function QuestionBody({ q, answers, matrix, onSingle, onRow, onField }: {
  q: Question
  answers: Answers
  matrix: (id: string) => Record<string, string>
  onSingle: (v: string) => void
  onRow: (qid: string, row: string, value: string) => void
  onField: (qid: string, field: string, value: string | boolean) => void
}) {
  if (q.type === 'single') {
    return (
      <Group>
        <div role="radiogroup" aria-label={q.prompt}>
          {q.options.map((o) => (
            <button key={o.id} className="cell" role="radio" aria-checked={answers[q.id] === o.id} onClick={() => onSingle(o.id)}>
              <span className={'rd' + (answers[q.id] === o.id ? ' on' : '')} />
              <div className="cb" style={{ padding: '13px 0' }}><span className="ttl">{o.label}</span></div>
              <span className="tr" />
            </button>
          ))}
        </div>
      </Group>
    )
  }
  if (q.type === 'matrix') {
    const m = matrix(q.id)
    return (
      <Group>
        {q.rows.map((r) => (
          <div key={r.id} className="cell rowq">
            <div><span className="ttl" style={{ fontWeight: 500 }}>{r.label}</span><div className="eg">{r.example}</div></div>
            <Segmented full label={r.label} value={String(m[r.id] ?? q.default)} onChange={(v) => onRow(q.id, r.id, v)} options={q.scale.map((s) => ({ value: s.id, label: s.label }))} />
          </div>
        ))}
      </Group>
    )
  }
  const vals = (answers[q.id] as Record<string, string | boolean>) ?? {}
  return (
    <>
      {q.fields.map((f) =>
        f.type === 'single' ? (
          <div key={f.id}>
            <SectionHeader>{f.label}</SectionHeader>
            <Group>
              <div role="radiogroup" aria-label={f.label}>
                {f.options!.map((o) => (
                  <button key={o.id} className="cell" role="radio" aria-checked={vals[f.id] === o.id} onClick={() => onField(q.id, f.id, o.id)}>
                    <span className={'rd' + (vals[f.id] === o.id ? ' on' : '')} />
                    <div className="cb" style={{ padding: '13px 0' }}><span className="ttl">{o.label}</span></div>
                    <span className="tr" />
                  </button>
                ))}
              </div>
            </Group>
          </div>
        ) : (
          <Group key={f.id} style={{ marginTop: 12 }}>
            <div className="cell">
              <div className="cb" style={{ padding: '10px 0' }}><span className="ttl">{f.label}</span></div>
              <Switch on={!!vals[f.id]} onChange={(v) => onField(q.id, f.id, v)} label={f.label} />
            </div>
          </Group>
        ),
      )}
    </>
  )
}

export type { Profile }
