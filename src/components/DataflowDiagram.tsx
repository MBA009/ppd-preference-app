import type { KeyboardEvent } from 'react'
import type { Device, Flow, Verdict } from '../api'
import { termLabel } from '../../shared/taxonomy'
import { VERDICTS, VERDICT_ORDER } from '../lib/verdicts'

/**
 * The privacy viewer's picture of a device: what kinds of data it handles (left) and who handles them (right).
 * Each band is one or more flows, as wide as the number of flows, coloured by how they compare with the
 * household's rules. Tapping a node selects it; the screen filters its flow list to match.
 */

export type Pick = { side: 'what' | 'who'; key: string } | null

const CONTEXT_ORDER = ['ppd:householdContext', 'ppd:vendorContext', 'ppd:thirdPartyContext', 'ppd:publicAudience']

/** "Your household", "Reolink", "Advertisers": the party the flow's data ends up with. */
export const whoOf = (f: Flow) => f.display.handled_by || termLabel('handling_context', f.taxonomy.handling_context)
export const whatOf = (f: Flow) => termLabel('data_type', f.core.data_type)

export const matches = (f: Flow, pick: Pick) => !pick || (pick.side === 'what' ? whatOf(f) : whoOf(f)) === pick.key

interface Node { key: string; n: number; context: string; y: number; h: number; slot: number }

function nodes(flows: Flow[], keyOf: (f: Flow) => string, rank: (a: Node, b: Node) => number): Node[] {
  const by = new Map<string, Node>()
  for (const f of flows) {
    const k = keyOf(f)
    const node = by.get(k) ?? { key: k, n: 0, context: f.taxonomy.handling_context, y: 0, h: 0, slot: 0 }
    node.n++
    by.set(k, node)
  }
  return [...by.values()].sort(rank)
}

/** Rough word wrap for SVG text: about `max` characters a line, at most two lines. */
function wrap(text: string, max: number): string[] {
  const words = text.split(' ')
  const lines: string[] = ['']
  for (const w of words) {
    const cur = lines[lines.length - 1]
    if (!cur) lines[lines.length - 1] = w
    else if ((cur + ' ' + w).length <= max) lines[lines.length - 1] = cur + ' ' + w
    else if (lines.length < 2) lines.push(w)
    else { lines[1] = (lines[1] + ' ' + w).slice(0, max - 1) + '…'; break }
  }
  if (lines[1] && lines[1].length > max) lines[1] = lines[1].slice(0, max - 1) + '…'
  return lines
}

const W = 340
const BAR = 6
const LX = 120 //  left bars start here
const RX = W - LX - BAR // right bars start here
const LABEL_GAP = 6
const GAP = 6

export function DataflowDiagram({ device, pick, onPick, compact = false }: {
  device: Device; pick: Pick; onPick?: (p: Pick) => void; compact?: boolean
}) {
  const flows = device.flows
  const unit = compact ? 4 : 6
  const SLOT_MIN = compact ? 28 : 44 // room for a two-line label (and the flow count under it)

  const what = nodes(flows, whatOf, (a, b) => b.n - a.n || a.key.localeCompare(b.key))
  const who = nodes(flows, whoOf, (a, b) => CONTEXT_ORDER.indexOf(a.context) - CONTEXT_ORDER.indexOf(b.context) || b.n - a.n || a.key.localeCompare(b.key))

  // Stack each column: a node's slot is at least tall enough for its label; its bar is centred in the slot.
  const stack = (col: Node[]) => {
    let y = 0
    for (const n of col) {
      n.h = n.n * unit
      n.slot = Math.max(n.h, SLOT_MIN)
      n.y = y + (n.slot - n.h) / 2
      y += n.slot + GAP
    }
    return y - GAP
  }
  const hl = stack(what)
  const hr = stack(who)
  const H = Math.max(hl, hr)
  // Centre the shorter column.
  for (const n of what) n.y += (H - hl) / 2
  for (const n of who) n.y += (H - hr) / 2

  // One band for each (what, who, verdict), stacked inside both nodes in a stable order.
  type Band = { what: Node; who: Node; verdict: Verdict; n: number; y0: number; y1: number }
  const bandMap = new Map<string, Band>()
  const whatIdx = new Map(what.map((n, i) => [n.key, i]))
  const whoIdx = new Map(who.map((n, i) => [n.key, i]))
  for (const f of flows) {
    const a = what[whatIdx.get(whatOf(f))!]
    const b = who[whoIdx.get(whoOf(f))!]
    const v = f.evaluation.verdict
    const k = `${a.key}|${b.key}|${v}`
    const band = bandMap.get(k) ?? { what: a, who: b, verdict: v, n: 0, y0: 0, y1: 0 }
    band.n++
    bandMap.set(k, band)
  }
  const bands = [...bandMap.values()]
  const vr = (v: Verdict) => VERDICT_ORDER.indexOf(v)
  const leftOff = new Map<string, number>()
  for (const b of [...bands].sort((p, q) => whoIdx.get(p.who.key)! - whoIdx.get(q.who.key)! || vr(p.verdict) - vr(q.verdict))) {
    const o = leftOff.get(b.what.key) ?? 0
    b.y0 = b.what.y + o
    leftOff.set(b.what.key, o + b.n * unit)
  }
  const rightOff = new Map<string, number>()
  for (const b of [...bands].sort((p, q) => whatIdx.get(p.what.key)! - whatIdx.get(q.what.key)! || vr(p.verdict) - vr(q.verdict))) {
    const o = rightOff.get(b.who.key) ?? 0
    b.y1 = b.who.y + o
    rightOff.set(b.who.key, o + b.n * unit)
  }

  const x0 = LX + BAR
  const x1 = RX
  const mx = (x0 + x1) / 2
  const lit = (b: Band) => !pick || (pick.side === 'what' ? b.what.key === pick.key : b.who.key === pick.key)
  const toggle = (side: 'what' | 'who', key: string) => onPick?.(pick && pick.side === side && pick.key === key ? null : { side, key })
  const onKey = (side: 'what' | 'who', key: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(side, key) }
  }
  const interactive = !!onPick

  const head = compact ? 0 : 22
  const label = (n: Node, side: 'what' | 'who') => {
    const lines = wrap(n.key, 19)
    const cy = n.y + n.h / 2
    const x = side === 'what' ? LX - LABEL_GAP : RX + BAR + LABEL_GAP
    const on = pick?.side === side && pick.key === n.key
    const dim = pick && !on && !(pick.side !== side && bands.some((b) => lit(b) && (side === 'what' ? b.what : b.who) === n))
    return (
      <g
        key={side + n.key}
        className={'df-node' + (on ? ' on' : '') + (dim ? ' dim' : '')}
        {...(interactive ? { role: 'button', tabIndex: 0, 'aria-pressed': on, onClick: () => toggle(side, n.key), onKeyDown: onKey(side, n.key) } : {})}
        aria-label={`${n.key}: ${n.n} ${n.n === 1 ? 'flow' : 'flows'}`}
      >
        <rect x={side === 'what' ? 0 : RX - 2} y={n.y + n.h / 2 - n.slot / 2} width={LX + BAR + 2} height={n.slot} fill="transparent" />
        <rect x={side === 'what' ? LX : RX} y={n.y} width={BAR} height={Math.max(n.h, 2)} rx={2} className="df-bar" />
        <text x={x} y={cy - (lines.length - 1) * 6.5} textAnchor={side === 'what' ? 'end' : 'start'} dominantBaseline="middle">
          {lines.map((l, i) => <tspan key={i} x={x} dy={i ? 13 : 0}>{l}</tspan>)}
        </text>
        {!compact && (
          <text x={side === 'what' ? LX - LABEL_GAP : RX + BAR + LABEL_GAP} y={n.y + n.h / 2 + (lines.length === 1 ? 13 : 19.5)} className="df-n" textAnchor={side === 'what' ? 'end' : 'start'} dominantBaseline="middle">
            {n.n} {n.n === 1 ? 'flow' : 'flows'}
          </text>
        )}
      </g>
    )
  }

  return (
    <svg className={'df' + (compact ? ' compact' : '')} viewBox={`0 ${-head} ${W} ${H + head + 12}`} role="img" aria-label={`Where ${device.short_name}'s data goes`}>
      {!compact && (
        <>
          <text x={LX + BAR} y={-10} textAnchor="end" className="df-h">What data</text>
          <text x={RX} y={-10} textAnchor="start" className="df-h">Who handles it</text>
        </>
      )}
      <g>
        {bands.map((b) => {
          const t = b.n * unit
          const d = `M${x0},${b.y0} C${mx},${b.y0} ${mx},${b.y1} ${x1},${b.y1} L${x1},${b.y1 + t} C${mx},${b.y1 + t} ${mx},${b.y0 + t} ${x0},${b.y0 + t} Z`
          return (
            <path key={`${b.what.key}|${b.who.key}|${b.verdict}`} d={d} className={`df-band ${VERDICTS[b.verdict].cls}${lit(b) ? '' : ' dim'}`}>
              <title>{`${b.what.key} → ${b.who.key}: ${b.n} ${b.n === 1 ? 'flow' : 'flows'}, ${VERDICTS[b.verdict].label.toLowerCase()}`}</title>
            </path>
          )
        })}
      </g>
      {what.map((n) => label(n, 'what'))}
      {who.map((n) => label(n, 'who'))}
    </svg>
  )
}

/** Verdict colours used by the bands, with how many flows each has. */
export function DataflowLegend({ device }: { device: Device }) {
  const counts = new Map<Verdict, number>()
  for (const f of device.flows) counts.set(f.evaluation.verdict, (counts.get(f.evaluation.verdict) ?? 0) + 1)
  return (
    <div className="ov-legend df-legend">
      {VERDICT_ORDER.filter((v) => counts.get(v)).map((v) => (
        <span key={v}><i className={VERDICTS[v].cls} style={{ background: 'var(--c)' }} />{VERDICTS[v].label} <b>{counts.get(v)}</b></span>
      ))}
    </div>
  )
}

/** "16 stay in your home · 7 go to Reolink · 3 go to other companies". */
export function contextSplit(device: Device): { context: string; n: number; label: string }[] {
  const vendor = [...new Set(device.flows.filter((f) => f.taxonomy.handling_context === 'ppd:vendorContext').map(whoOf))]
  const label: Record<string, string> = {
    'ppd:householdContext': 'Stay in your home',
    'ppd:vendorContext': vendor.length === 1 ? `Go to ${vendor[0]}` : 'Go to the maker’s services',
    'ppd:thirdPartyContext': 'Go to other companies',
    'ppd:publicAudience': 'Made public',
  }
  return CONTEXT_ORDER.map((c) => ({ context: c, n: device.flows.filter((f) => f.taxonomy.handling_context === c).length, label: label[c] })).filter((x) => x.n)
}
