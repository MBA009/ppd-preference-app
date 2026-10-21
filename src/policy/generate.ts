import type { Answers, AnswerValue, Condition, Profile, Question, Questionnaire, Rule } from '../api'

/**
 * The decision tree as code: answers go in, rules come out. The tree itself is data
 * (public/mock/questionnaire.json); this file only walks it.
 */

type Matrix = Record<string, string | boolean>

const asMatrix = (v: AnswerValue | undefined): Matrix => (v && typeof v === 'object' ? (v as Matrix) : {})

/** Defaults, then prefills from earlier answers, then whatever the person touched. */
export function resolveAnswers(q: Questionnaire, touched: Answers): Answers {
  const out: Answers = {}
  for (const k of q.questions) {
    if (k.type === 'matrix') out[k.id] = Object.fromEntries(k.rows.map((r) => [r.id, k.default]))
    else if (k.type === 'profile') out[k.id] = Object.fromEntries(k.fields.map((f) => [f.id, f.default]))
    else if (k.default !== null) out[k.id] = k.default
  }
  for (const k of q.questions) {
    if (k.type !== 'single') continue
    const picked = touched[k.id]
    const opt = k.options.find((o) => o.id === picked)
    for (const p of opt?.prefill ?? []) out[p.question] = { ...asMatrix(out[p.question]), [p.row]: p.value }
  }
  for (const [id, v] of Object.entries(touched)) {
    out[id] = typeof v === 'object' ? { ...asMatrix(out[id]), ...v } : v
  }
  return out
}

export function evalCondition(c: Condition, a: Answers): boolean {
  if ('not' in c) return !evalCondition(c.not, a)
  if ('all' in c) return c.all.every((x) => evalCondition(x, a))
  if ('any' in c) return c.any.some((x) => evalCondition(x, a))
  if ('all_rows' in c) {
    const m = asMatrix(a[c.all_rows.question])
    const vals = Object.values(m)
    return vals.length > 0 && vals.every((v) => v === c.all_rows.equals)
  }
  const v = a[c.answer.question]
  return typeof v === 'string' && (c.answer.equals !== undefined ? v === c.answer.equals : !!c.answer.in?.includes(v))
}

export const visibleQuestions = (q: Questionnaire, a: Answers): Question[] => q.questions.filter((k) => !k.show_if || evalCondition(k.show_if, a))

export function generatePolicy(q: Questionnaire, a: Answers): { rules: Rule[]; profile: Profile } {
  const rules: Rule[] = []
  let profile: Profile = { summary_frequency: 'monthly', warn_on_conflict: true }
  for (const k of visibleQuestions(q, a)) {
    if (k.type === 'matrix') {
      const m = asMatrix(a[k.id])
      for (const row of k.rows) {
        const value = String(m[row.id] ?? k.default)
        const step = k.scale.find((s) => s.id === value)
        if (!step) continue
        rules.push({
          id: `${k.id}.${row.id}`, title: row.titles[value], effect: step.effect, scope: row.scope, enabled: true,
          origin: { kind: 'questionnaire', question_id: k.id, row_id: row.id, answer: value },
        })
      }
    } else if (k.type === 'single') {
      const opt = k.options.find((o) => o.id === a[k.id])
      for (const r of opt?.rules ?? []) {
        rules.push({ ...r, enabled: true, origin: { kind: 'questionnaire', question_id: k.id, answer: opt!.id } })
      }
    } else {
      const m = asMatrix(a[k.id])
      profile = {
        summary_frequency: (m.summary_frequency as Profile['summary_frequency']) ?? profile.summary_frequency,
        warn_on_conflict: typeof m.warn_on_conflict === 'boolean' ? m.warn_on_conflict : profile.warn_on_conflict,
      }
    }
  }
  return { rules, profile }
}

/** "Made from your answer to: Data that leaves your home" for a generated rule; null for one the person added. */
export function originLabel(q: Questionnaire | undefined, r: Rule): string | null {
  if (r.origin.kind !== 'questionnaire') return null
  const id = r.origin.question_id
  return q?.questions.find((k) => k.id === id)?.short ?? null
}
