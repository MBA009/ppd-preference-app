import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Answers, type Decision, type Device, type DeviceSummary, type Household, type Profile, type Questionnaire, type Rule } from '../api'

/* ---------- tiny async hook ---------- */
export interface Async<T> { data: T | undefined; error: Error | undefined; loading: boolean }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, set] = useState<Async<T>>({ data: undefined, error: undefined, loading: true })
  useEffect(() => {
    let live = true
    set((s) => ({ ...s, loading: true, error: undefined }))
    fn().then(
      (data) => live && set({ data, error: undefined, loading: false }),
      (error: Error) => live && set({ data: undefined, error, loading: false }),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export const useQuestionnaire = () => useAsync<Questionnaire>(() => api.getQuestionnaire(), [])
export const useLibrary = () => useAsync<DeviceSummary[]>(() => api.listLibrary(), [])

/** Changes whenever the household's rules change, so device data (whose verdicts depend on the rules) is fetched again. */
function useRulesKey(): string {
  const { household } = useHousehold()
  return JSON.stringify((household?.rules ?? []).map((r) => [r.id, r.effect, r.enabled, r.scope]))
}

export const useDevice = (id: string | undefined) => {
  const key = useRulesKey()
  return useAsync<Device>(() => api.getDevice(id!), [id, key])
}
export const useDevices = (ids: string[]) => {
  const key = useRulesKey()
  return useAsync<Device[]>(() => Promise.all(ids.map((i) => api.getDevice(i))), [ids.join('|'), key])
}

/** The household's rules, in policy order. Pass `onlyOn` to leave out rules the person switched off. */
export function useRules(onlyOn = false): Rule[] {
  const { household } = useHousehold()
  const all = household?.rules ?? []
  return onlyOn ? all.filter((r) => r.enabled) : all
}

/* ---------- household (devices in the home + saved decisions) ---------- */
interface Ctx {
  household: Household | null
  error: Error | null
  addDevice: (id: string, opts?: { joined?: boolean }) => Promise<void>
  removeDevice: (id: string) => Promise<void>
  saveForLater: (id: string) => Promise<void>
  markJoinedSeen: (id: string) => Promise<void>
  saveDecision: (d: Omit<Decision, 'decided_at'>) => Promise<void>
  resetDemo: (mode: 'seed' | 'empty') => Promise<void>
  savePolicy: (p: { answers: Answers; rules: Rule[]; profile: Profile }) => Promise<void>
  upsertRule: (r: Rule) => Promise<void>
  deleteRule: (id: string) => Promise<void>
  toast: (text: string) => void
}

const HouseholdCtx = createContext<Ctx | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<Household | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number>()

  useEffect(() => {
    api.getHousehold().then(setHousehold, setError)
  }, [])

  const toast = useCallback((text: string) => {
    setMessage(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 2600)
  }, [])

  const run = useCallback(<A extends unknown[]>(fn: (...a: A) => Promise<Household>) => async (...a: A) => {
    try { setHousehold(await fn(...a)) } catch (e) { setError(e as Error) }
  }, [])

  const value = useMemo<Ctx>(() => ({
    household, error, toast,
    addDevice: run(api.addDevice), removeDevice: run(api.removeDevice), saveForLater: run(api.saveForLater),
    markJoinedSeen: run(api.markJoinedSeen), saveDecision: run(api.saveDecision), resetDemo: run(api.resetDemo),
    savePolicy: run(api.savePolicy), upsertRule: run(api.upsertRule), deleteRule: run(api.deleteRule),
  }), [household, error, toast, run])

  return (
    <HouseholdCtx.Provider value={value}>
      {children}
      {message && <div className="toast" role="status">{message}</div>}
    </HouseholdCtx.Provider>
  )
}

export function useHousehold() {
  const c = useContext(HouseholdCtx)
  if (!c) throw new Error('useHousehold must be used inside <HouseholdProvider>')
  return c
}
