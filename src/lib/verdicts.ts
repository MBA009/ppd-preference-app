import type { Verdict } from '../api'

export interface VerdictMeta {
  /** CSS colour class (.ok .lim .bad .unk). */
  cls: 'ok' | 'lim' | 'bad' | 'unk'
  /** The full label, as in the verdict reference board. */
  label: string
  /** Tile colour used on the flow detail banner. */
  tile: 'green' | 'blue' | 'grey' | 'red'
  chip: (n: number) => string
}

export const VERDICTS: Record<Verdict, VerdictMeta> = {
  unsatisfiable: { cls: 'bad', label: 'Conflicts with your rules', tile: 'red', chip: (n) => `${n} ${n === 1 ? 'conflict' : 'conflicts'}` },
  indeterminate: { cls: 'unk', label: 'Not described in terms we can read', tile: 'grey', chip: (n) => `${n} not readable` },
  conditionally_satisfiable: { cls: 'lim', label: 'With limits', tile: 'blue', chip: (n) => `${n} with limits` },
  compatible: { cls: 'ok', label: 'Matches your rules', tile: 'green', chip: (n) => `${n} ${n === 1 ? 'matches' : 'match'}` },
}

/** Chip order everywhere: worst first. */
export const VERDICT_ORDER: Verdict[] = ['unsatisfiable', 'indeterminate', 'conditionally_satisfiable', 'compatible']

export { countVerdicts, needsAttention } from '../../shared/engine'

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
