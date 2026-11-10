import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Device, Flow, Verdict } from '../api'
import { termLabel } from '../../shared/taxonomy'
import { VERDICTS, VERDICT_ORDER } from '../lib/verdicts'

/**
 * The privacy viewer's picture of a device: what kinds of data it handles (left) and where that data goes (right).
 * Each band is one or more flows, as wide as the number of flows, coloured by how they compare with the
 * household's rules. Tapping a node selects it; the screen filters its flow list to match.
 */

/** What the viewer is filtered to: a kind of data, a place the data goes, or a verdict (from the legend). */
export type Pick = { side: 'what' | 'who' | 'verdict'; key: string } | null

const CONTEXT_ORDER = ['ppd:householdContext', 'ppd:vendorContext', 'ppd:thirdPartyContext', 'ppd:publicAudience']

/** Where the flow's data goes: "Stays in your home", or the party it ends up with ("Reolink", "Advertisers"). */
export const whoOf = (f: Flow) =>
  f.taxonomy.handling_context === 'ppd:householdContext' ? 'Stays in your home' : f.display.handled_by || termLabel('handling_context', f.taxonomy.handling_context)
export const whatOf = (f: Flow) => termLabel('data_type', f.core.data_type)

const keyOf = (f: Flow, side: NonNullable<Pick>['side']) => (side === 'what' ? whatOf(f) : side === 'who' ? whoOf(f) : f.evaluation.verdict)
export const matches = (f: Flow, pick: Pick) => !pick || keyOf(f, pick.side) === pick.key

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

/** Word wrap for SVG text: about `max` characters a line, up to three lines; only a longer label is shortened. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = ['']
  for (const w of text.split(' ')) {
    const cur = lines[lines.length - 1]
    if (!cur) lines[lines.length - 1] = w
    else if ((cur + ' ' + w).length <= max) lines[lines.length - 1] = cur + ' ' + w
    else lines.push(w)
  }
  if (lines.length > 3) lines.splice(2, lines.length, (lines.slice(2).join(' ')).slice(0, max - 1) + '…')
  return lines
}

// The chart is drawn at its real size (no scaling), so the labels stay the same small size on a phone and a desktop;
// a wider card gives the bands and the labels more room.
const W_MIN = 300
const W_MAX = 640
const BAR = 6
const LABEL_GAP = 6
const LINE = 14 // label line height, for the 12px label text (.df in app.css): the app's small text size
const GAP = 6

export function DataflowDiagram({ device, pick, onPick, compact = false }: {
  device: Device; pick: Pick; onPick?: (p: Pick) => void; compact?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(340)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setW(Math.round(Math.min(W_MAX, Math.max(W_MIN, el.clientWidth))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const LX = W >= 480 ? 150 : 120 // left bars start here; the labels' column is this wide on each side
  const RX = W - LX - BAR //          right bars start here
  const chars = Math.floor((LX - LABEL_GAP - 4) / 6.3) // about how many 12px characters fit a label line
  const linesOf = (key: string) => wrap(key, chars)
  const flows = device.flows
  const unit = compact ? 4 : 6

  const what = nodes(flows, whatOf, (a, b) => b.n - a.n || a.key.localeCompare(b.key))
  const who = nodes(flows, whoOf, (a, b) => CONTEXT_ORDER.indexOf(a.context) - CONTEXT_ORDER.indexOf(b.context) || b.n - a.n || a.key.localeCompare(b.key))

  // Stack each column: a node's slot is tall enough for its label (and the flow count under it); its bar is centred in it.
  const stack = (col: Node[]) => {
    let y = 0
    for (const n of col) {
      n.h = n.n * unit
      n.slot = Math.max(n.h, (linesOf(n.key).length + (compact ? 0 : 1)) * LINE + 4)
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
  const lit = (b: Band) => !pick || (pick.side === 'what' ? b.what.key : pick.side === 'who' ? b.who.key : b.verdict) === pick.key
  const toggle = (side: 'what' | 'who', key: string) => onPick?.(pick && pick.side === side && pick.key === key ? null : { side, key })
  const onKey = (side: 'what' | 'who', key: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(side, key) }
  }
  const interactive = !!onPick

  const head = compact ? 0 : 22
  const label = (n: Node, side: 'what' | 'who') => {
    const lines = linesOf(n.key)
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
        <text x={x} y={cy - (lines.length - 1) * (LINE / 2)} textAnchor={side === 'what' ? 'end' : 'start'} dominantBaseline="middle">
          {lines.map((l, i) => <tspan key={i} x={x} dy={i ? LINE : 0}>{l}</tspan>)}
        </text>
        {!compact && (
          <text x={side === 'what' ? LX - LABEL_GAP : RX + BAR + LABEL_GAP} y={n.y + n.h / 2 + (lines.length + 1) * (LINE / 2)} className="df-n" textAnchor={side === 'what' ? 'end' : 'start'} dominantBaseline="middle">
            {n.n} {n.n === 1 ? 'flow' : 'flows'}
          </text>
        )}
      </g>
    )
  }

  return (
    <div ref={box} className="df-box">
    <svg className={'df' + (compact ? ' compact' : '')} width={W} height={H + head + 12} viewBox={`0 ${-head} ${W} ${H + head + 12}`} role="img" aria-label={`Where ${device.short_name}'s data goes`}>
      {!compact && (
        <>
          <text x={LX + BAR} y={-10} textAnchor="end" className="df-h">What data</text>
          <text x={RX} y={-10} textAnchor="start" className="df-h">Where it goes</text>
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
    </div>
  )
}

/** Verdict colours used by the bands, with how many flows each has. With `onPick`, each one filters to its flows. */
export function DataflowLegend({ device, pick, onPick }: { device: Device; pick?: Pick; onPick?: (p: Pick) => void }) {
  const counts = new Map<Verdict, number>()
  for (const f of device.flows) counts.set(f.evaluation.verdict, (counts.get(f.evaluation.verdict) ?? 0) + 1)
  return (
    <div className="ov-legend df-legend">
      {VERDICT_ORDER.filter((v) => counts.get(v)).map((v) => {
        const body = <><i className={VERDICTS[v].cls} style={{ background: 'var(--c)' }} />{VERDICTS[v].label} <b>{counts.get(v)}</b></>
        if (!onPick) return <span key={v}>{body}</span>
        const on = pick?.side === 'verdict' && pick.key === v
        const dim = !!pick && pick.side === 'verdict' && !on
        return (
          <button key={v} className={`df-vf ${VERDICTS[v].cls}` + (on ? ' on' : '') + (dim ? ' dim' : '')} aria-pressed={on} onClick={() => onPick(on ? null : { side: 'verdict', key: v })}>
            {body}
          </button>
        )
      })}
    </div>
  )
}

/** "16 stay in your home · 8 go to the manufacturer · 2 go to 3rd parties": the same words for every device. */
export function contextSplit(device: Device): { context: string; n: number; label: string }[] {
  const label: Record<string, string> = {
    'ppd:householdContext': 'Stay in your home',
    'ppd:vendorContext': 'Go to the manufacturer',
    'ppd:thirdPartyContext': 'Go to 3rd parties',
    'ppd:publicAudience': 'Made public',
  }
  return CONTEXT_ORDER.map((c) => ({ context: c, n: device.flows.filter((f) => f.taxonomy.handling_context === c).length, label: label[c] })).filter((x) => x.n)
}
