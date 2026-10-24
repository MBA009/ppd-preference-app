import type { Answers, Onboarding, OnboardingNode } from './types'

/**
 * Walking the onboarding tree (public/mock/onboarding.json): show a question, follow the branch whose
 * answers contain the chosen option, and stop at a preset. A question can come back further down a path
 * with a finer split; the earlier answer is reused, so it is never asked twice.
 */

/** Where the walk stands: the next question to ask, or the preset it ends in. */
export type Step = { question: string } | { preset: string }

export function walk(tree: Onboarding, answers: Answers): Step {
  let node: OnboardingNode = tree.root
  while ('question' in node) {
    const answer = answers[node.question]
    const branch = answer === undefined ? undefined : node.branches.find((b) => b.answers.includes(answer))
    if (!branch) return { question: node.question }
    node = branch.next
  }
  return { preset: node.preset }
}

/** The most questions still to ask before a preset, counting a repeated question once. */
export function questionsLeft(node: OnboardingNode, answers: Answers, known: ReadonlySet<string> = new Set()): number {
  if (!('question' in node)) return 0
  const answer = answers[node.question]
  const branch = answer === undefined ? undefined : node.branches.find((b) => b.answers.includes(answer))
  if (branch) return questionsLeft(branch.next, answers, known)
  const asked = known.has(node.question)
  const next = asked ? known : new Set([...known, node.question])
  return (asked ? 0 : 1) + Math.max(...node.branches.map((b) => questionsLeft(b.next, answers, next)))
}
