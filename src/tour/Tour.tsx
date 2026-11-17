import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useHousehold, useMe } from '../state/data'

/**
 * Guided setup: one mode that walks a new household through the app with coach marks (a dimmed screen, the element
 * being explained cut out of it, and a tooltip with "2 / 3" and Next).
 *
 * The run: start from first launch → the questions → save the household policy → the demo simulator's devices are
 * turned on one by one, so they join through PPD and pick up the new rules → My Home, where the audience watches
 * them arrive → the Policy tab → each part of the Household policy page.
 *
 * Screens mark what the tour can point at with `data-tour="…"`. A coach mark shows only on its path and once its
 * element is on screen; if the person moves on without it (a screen that has no such element), the tour skips ahead
 * to the next mark it can show. The run is kept in sessionStorage, so a reload carries on where it was.
 */

type Ctx = { sim: boolean; devices: number }
type Mark = {
  id: string
  /** The route the mark belongs to (exact pathname). */
  path: string
  /** The `data-tour` value of the element to highlight. */
  target: string
  /** Marks in the same group count as "n / total" together, one screen's worth. */
  group: string
  title: string
  body: string | ((c: Ctx) => string)
  /** The person goes on by tapping the highlighted element itself (Start, Next…), not a Next button in the tooltip. */
  click?: string
}

const MARKS: Mark[] = [
  { id: 'welcome', path: '/rules', target: 'start-card', group: 'welcome', title: 'Welcome to your home’s privacy', body: 'A few questions about your household. Your answers become one household policy that every device supporting PPD receives.' },
  { id: 'start', path: '/rules', target: 'start-button', group: 'welcome', title: 'Let’s begin', body: 'There are no wrong answers, and you can change any rule afterwards.', click: 'Tap Start' },

  { id: 'progress', path: '/rules', target: 'q-progress', group: 'question', title: 'One situation per screen', body: 'The bar shows how far along you are. Most households are done in under two minutes.' },
  { id: 'options', path: '/rules', target: 'q-options', group: 'question', title: 'Pick what fits your home', body: 'Choose the answer closest to how you feel. If you are unsure, pick the middle option.' },
  { id: 'next', path: '/rules', target: 'q-next', group: 'question', title: 'Then tap Next', body: 'Answer the rest on your own. We’ll meet again when your policy is ready.' },

  // Between the first set of questions (the decision tree) and the follow-ups. Households whose answers leave nothing
  // to follow up skip this screen, and the tour skips this mark.
  { id: 'details', path: '/rules', target: 'details-continue', group: 'details', title: 'Nice work, keep going', body: 'That’s the first set done. A few more questions now, about situations households like yours disagree on, so we ask instead of guessing.', click: 'Tap Continue' },

  { id: 'finish', path: '/rules', target: 'finish', group: 'finish', title: 'Your policy is ready', body: (c) => c.sim ? 'Save it, and we’ll switch on a few demo devices so you can watch them pick up your rules.' : 'Save it to make it your household policy.', click: 'Tap the button to save' },

  { id: 'overview', path: '/rules', target: 'rules-overview', group: 'policy', title: 'Your household rules', body: 'Built from your answers: what devices may never do, may do with a condition, and may do. Tap a group below to see its rules.' },
  { id: 'joining', path: '/rules', target: 'rules-done', group: 'policy', title: '', body: (c) => c.sim ? `We just switched on ${c.devices || 'a few'} demo devices. They’re joining your network now. Let’s go and watch.` : 'The demo simulator is off, so no demo devices join. Start app-api with SIMULATOR=1 to see them.', click: 'Tap Looks good' },

  { id: 'readiness', path: '/', target: 'home-readiness', group: 'home', title: 'Privacy readiness', body: 'How many devices are on your network, and how many hold your rules. The numbers change as devices join.' },
  { id: 'devices', path: '/', target: 'home-devices', group: 'home', title: 'Devices that join through PPD', body: 'They find your home gateway, get your household policy and confirm it, all on their own. Tap one to see what it does with your data.' },
  { id: 'unmanaged', path: '/', target: 'home-unmanaged', group: 'home', title: 'On your network, no PPD', body: 'Devices like this TV can’t receive your rules. We show what our research knows about them instead.' },
  { id: 'scan', path: '/', target: 'nav-scan', group: 'home', title: 'Check before you buy', body: 'Scan a device’s privacy code in the store to see how it fits your rules.' },
  { id: 'policy', path: '/', target: 'nav-rules', group: 'home', title: 'Your policy, any time', body: 'Change a rule, add your own, or answer a few more questions to fine-tune it. Let’s have a look.', click: 'Tap Policy' },

  // The Household policy page, now that devices have joined and the rules are in use.
  { id: 'p-overview', path: '/rules', target: 'rules-overview', group: 'policy-page', title: 'Your rules at a glance', body: 'How many rules your household has, and how they split into never, allowed with a condition, and allowed. Below that: what your devices say they do, checked against these rules.' },
  { id: 'p-publish', path: '/rules', target: 'rules-publish', group: 'policy-page', title: 'Sent automatically', body: 'There’s no send button. When you change a rule, your devices get the new policy within seconds, and this card shows how that’s going.' },
  { id: 'p-group', path: '/rules', target: 'rules-group', group: 'policy-page', title: 'Rules by what they do', body: 'Open a group to see its rules. The ones your devices use come first. Tap any rule to change it or switch it off.' },
  { id: 'p-refine', path: '/rules', target: 'rules-refine', group: 'policy-page', title: 'Fine-tune with a few questions', body: 'More situations households like yours are split on. Answer as many or as few as you like; your own changes stay.' },
  { id: 'p-add', path: '/rules', target: 'rules-add', group: 'policy-page', title: 'Add your own rule', body: 'For anything the questions didn’t cover. If two rules disagree, your latest change wins.' },
  { id: 'p-json', path: '/rules', target: 'rules-json', group: 'policy-page', title: 'See exactly what’s sent', body: 'Your rules as JSON, and the PPD policy your devices receive.' },
  { id: 'p-startover', path: '/rules', target: 'rules-startover', group: 'policy-page', title: 'Start over', body: 'Answer the questions again to rebuild your rules, or reset everything. Devices that are connected stay connected.' },
]
// The "joining" mark's title depends on whether devices are coming.
const titleOf = (m: Mark, c: Ctx) => (m.id === 'joining' ? (c.sim ? 'Demo devices are joining' : 'Your policy is saved') : m.title)

type State = { active: boolean; index: number; devices: 'pending' | 'started' }
const OFF: State = { active: false, index: 0, devices: 'pending' }
const KEY = 'ppd.tour'

function load(): State {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as State | null
    if (s && typeof s.index === 'number' && s.active) return s
  } catch { /* storage may be blocked: start without a tour */ }
  return OFF
}

interface TourApi {
  active: boolean
  /** Starts the guided setup. `reset` (the default) clears the household and switches the demo devices off first. */
  start: (opts?: { reset?: boolean }) => Promise<void>
  end: () => void
}
const TourCtx = createContext<TourApi | null>(null)

export function useTour() {
  const c = useContext(TourCtx)
  if (!c) throw new Error('useTour must be used inside <TourProvider>')
  return c
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

export function TourProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load)
  const [joining, setJoining] = useState(0)
  const { household, resetDemo, toast } = useHousehold()
  const { data: me } = useMe()
  const nav = useNavigate()

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)) } catch { /* the tour still runs, it just won't survive a reload */ }
  }, [state])

  const start = useCallback(async ({ reset = true }: { reset?: boolean } = {}) => {
    if (reset) {
      const who = await api.getMe().catch(() => null)
      if (who?.simulator) await api.simReset().catch(() => undefined)
      await resetDemo('empty')
    }
    setJoining(0)
    setState({ active: true, index: 0, devices: 'pending' })
    nav('/rules', { replace: true })
  }, [nav, resetDemo])

  const end = useCallback(() => setState(OFF), [])

  // Once the household has its policy, the demo devices are switched on one at a time: the PPD ones connect (and so
  // receive the new rules), then the others join the network without PPD.
  useEffect(() => {
    if (!state.active || state.devices !== 'pending' || !household?.preset_id) return
    setState((s) => ({ ...s, devices: 'started' }))
    void (async () => {
      const who = await api.getMe().catch(() => null)
      if (!who?.simulator) return
      const sims = await api.listSimDevices().catch(() => [])
      const order = [...sims.filter((d) => d.mode === 'ppd'), ...sims.filter((d) => d.mode === 'network')]
      setJoining(order.length)
      for (const d of order) {
        try {
          await (d.mode === 'ppd' ? api.simConnect(d.id) : api.simNetwork(d.id, true))
        } catch (e) {
          toast(`${d.short_name} could not join: ${(e as Error).message}`)
        }
        await wait(1500)
      }
    })()
  }, [state.active, state.devices, household?.preset_id, toast])

  const go = useCallback((index: number) => {
    if (index < MARKS.length) {
      setState((s) => ({ ...s, index }))
    } else {
      setState(OFF)
      toast('That’s the tour. Replay it any time from Test tools.')
    }
  }, [toast])

  const value = useMemo<TourApi>(() => ({ active: state.active, start, end }), [state.active, start, end])
  const ctx: Ctx = { sim: !!me?.simulator, devices: joining }

  return (
    <TourCtx.Provider value={value}>
      {children}
      {state.active && <Coach marks={MARKS} index={state.index} ctx={ctx} onGo={go} onEnd={end} />}
    </TourCtx.Provider>
  )
}

/** The highlighted element: on screen and laid out (the bottom tabs and the side rail are hidden at some widths). */
function visible(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

/** `from`: the tour step this lookup was made for (after Back, an older lookup must not count as skipping ahead). */
type Found = { from: number; i: number; top: number; left: number; width: number; height: number }
const SKIP_AFTER_MS = 1500

function Coach({ marks, index, ctx, onGo, onEnd }: { marks: Mark[]; index: number; ctx: Ctx; onGo: (i: number) => void; onEnd: () => void }) {
  const { pathname } = useLocation()
  const [found, setFound] = useState<Found | null>(null)
  const primary = useRef<HTMLButtonElement>(null)

  // Look for the current mark (or, if this screen doesn't have it, the next one that it does have) and follow its
  // position as the page scrolls, resizes or loads more content.
  // A later mark is shown only after the current one has been missing for a moment: screens load in pieces, and the
  // current element may simply not be there yet.
  useEffect(() => {
    let shown = -1
    let missingSince = 0
    const tick = () => {
      for (let i = index; i < marks.length; i++) {
        const m = marks[i]
        if (m.path !== pathname) continue
        const el = visible(m.target)
        if (!el) continue
        if (i === index) missingSince = 0
        else if (shown !== i) {
          missingSince ||= Date.now()
          if (Date.now() - missingSince < SKIP_AFTER_MS) break
        }
        if (shown !== i) {
          shown = i
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
        const r = el.getBoundingClientRect()
        setFound((f) => f && f.from === index && f.i === i && f.top === r.top && f.left === r.left && f.width === r.width && f.height === r.height ? f : { from: index, i, top: r.top, left: r.left, width: r.width, height: r.height })
        return
      }
      shown = -1
      setFound(null)
    }
    tick()
    const timer = window.setInterval(tick, 150)
    window.addEventListener('resize', tick)
    window.addEventListener('scroll', tick, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', tick)
      window.removeEventListener('scroll', tick, true)
    }
  }, [marks, index, pathname])

  // Skipped ahead: that is where the tour is now.
  useEffect(() => { if (found && found.from === index && found.i > index) onGo(found.i) }, [found, index, onGo])

  const mark = found ? marks[found.i] : null

  // A "tap the button" mark moves on when the highlighted element itself is tapped (the tap still does its job).
  useEffect(() => {
    if (!mark?.click || !found) return
    const i = found.i
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest(`[data-tour="${mark.target}"]`)) onGo(i + 1)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [mark, found, onGo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEnd() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEnd])

  useEffect(() => { primary.current?.focus({ preventScroll: true }) }, [mark?.id])

  if (!found || !mark) return null

  const group = marks.filter((m) => m.group === mark.group)
  const n = group.indexOf(mark) + 1
  const lastInGroup = n === group.length
  const last = found.i === marks.length - 1
  const prev = n > 1 ? marks.indexOf(group[n - 2]) : -1

  // The hole, a little bigger than the element and kept on screen.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 6
  const top = Math.max(found.top - pad, 8)
  const left = Math.max(found.left - pad, 8)
  const bottom = Math.min(found.top + found.height + pad, vh - 8)
  const right = Math.min(found.left + found.width + pad, vw - 8)
  const hole = { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) }

  // The tooltip goes under the element if there's room, else over it, else pinned to the bottom of the screen.
  const width = Math.min(340, vw - 32)
  const room = 200
  const place: 'below' | 'above' | 'pinned' = vh - bottom >= room ? 'below' : top >= room ? 'above' : 'pinned'
  const tipLeft = Math.min(Math.max(found.left + found.width / 2 - width / 2, 16), vw - width - 16)
  const arrow = Math.min(Math.max(found.left + found.width / 2 - tipLeft, 22), width - 22)
  const tipStyle: React.CSSProperties =
    place === 'below' ? { top: bottom + 12, left: tipLeft, width }
      : place === 'above' ? { bottom: vh - top + 12, left: tipLeft, width }
        : { bottom: 24, left: tipLeft, width }

  const body = typeof mark.body === 'function' ? mark.body(ctx) : mark.body
  const title = titleOf(mark, ctx)

  // Taps outside the hole are caught; for a "tap the button" mark the hole itself stays open.
  const blockers = mark.click
    ? [
        { top: 0, left: 0, width: vw, height: hole.top },
        { top: hole.top + hole.height, left: 0, width: vw, height: Math.max(vh - hole.top - hole.height, 0) },
        { top: hole.top, left: 0, width: hole.left, height: hole.height },
        { top: hole.top, left: hole.left + hole.width, width: Math.max(vw - hole.left - hole.width, 0), height: hole.height },
      ]
    : [{ top: 0, left: 0, width: vw, height: vh }]

  return createPortal(
    <div className="tour" role="presentation">
      {blockers.map((b, i) => <div key={i} className="tour-block" style={b} />)}
      <div className={'tour-hole' + (mark.click ? ' tap' : '')} style={hole} />
      <div className={`tour-tip ${place}`} style={tipStyle} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
        {place !== 'pinned' && <i className="tour-arrow" style={{ left: arrow }} />}
        <button className="tour-x" aria-label="End the tour" onClick={onEnd}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" /></svg>
        </button>
        <h2 id="tour-title">{title}</h2>
        <p id="tour-body">{body}</p>
        <div className="tour-foot">
          <span className="tour-n">{group.length > 1 ? `${n} / ${group.length}` : ''}</span>
          {prev >= 0 && <button className="tour-btn2" onClick={() => onGo(prev)}>Back</button>}
          {mark.click
            ? <span className="tour-hint">{mark.click}</span>
            : <button ref={primary} className="tour-btn" onClick={() => onGo(found.i + 1)}>{last ? 'Finish' : lastInGroup ? 'OK' : 'Next'}</button>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
