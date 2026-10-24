import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Answers, type Command, type Device, type DeviceSummary, type Household, type HouseholdPreset, type Me, type Onboarding, type Overview, type Policy, type Profile, type PublishPreview, type Rule, type SimDevice, type SystemStatus, type Telemetry, type UnmanagedDevice } from '../api'

/* ---------- tiny async hook ---------- */
export interface Async<T> { data: T | undefined; error: Error | undefined; loading: boolean; reload: () => void }

/**
 * Runs `fn` when `deps` change. With `pollMs` it runs again on that interval while the page is visible,
 * keeping the last good data on screen (live gateway views refresh this way).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number): Async<T> {
  const [state, set] = useState<Omit<Async<T>, 'reload'>>({ data: undefined, error: undefined, loading: true })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    let live = true
    set((s) => ({ ...s, loading: true, error: undefined }))
    fn().then(
      (data) => live && set({ data, error: undefined, loading: false }),
      (error: Error) => live && set((s) => ({ data: s.data, error, loading: false })),
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  useEffect(() => {
    if (!pollMs) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload() }, pollMs)
    return () => window.clearInterval(timer)
  }, [pollMs, reload])
  return { ...state, reload }
}

/** Live gateway views refresh this often. */
export const LIVE_POLL_MS = 5000

export const useOnboarding = () => useAsync<Onboarding>(() => api.getOnboarding(), [])
export const useHouseholdPresets = () => useAsync<HouseholdPreset[]>(() => api.listHouseholdPresets(), [])
export const useLibrary = () => useAsync<DeviceSummary[]>(() => api.listLibrary(), [])
export const useMe = () => useAsync<Me>(() => api.getMe(), [])
export const useOverview = () => useAsync<Overview>(() => api.getOverview(), [], LIVE_POLL_MS)
export const useSystemStatus = () => useAsync<SystemStatus>(() => api.getSystemStatus(), [], LIVE_POLL_MS * 2)
export const useCommands = (id: string | undefined) => useAsync<Command[]>(() => (id ? api.listCommands(id) : Promise.resolve([])), [id], 3000)
export const useUnmanaged = () => useAsync<UnmanagedDevice[]>(() => api.listUnmanaged(), [], LIVE_POLL_MS)
export const useSimDevices = () => useAsync<SimDevice[]>(() => api.listSimDevices(), [], 2000)
export const useTelemetry = (id: string | undefined) => useAsync<Telemetry>(() => (id ? api.getTelemetry(id) : Promise.resolve({ samples: [], by_purpose: [] })), [id], LIVE_POLL_MS)

/** Changes whenever the household's rules change, so device data (whose verdicts depend on the rules) is fetched again. */
function useRulesKey(): string {
  const { household } = useHousehold()
  return JSON.stringify((household?.rules ?? []).map((r) => [r.id, r.effect, r.condition, r.enabled, r.scope]))
}

export const useDevice = (id: string | undefined, poll = false) => {
  const key = useRulesKey()
  return useAsync<Device>(() => api.getDevice(id!), [id, key], poll ? LIVE_POLL_MS : undefined)
}
export const useDevices = (ids: string[], poll = false) => {
  const key = useRulesKey()
  return useAsync<Device[]>(() => Promise.all(ids.map((i) => api.getDevice(i))), [ids.join('|'), key], poll ? LIVE_POLL_MS : undefined)
}

/** The household policy the gateway serves now, and what publishing the current rules would send. */
export const usePublished = () => useAsync<Policy | null>(() => api.getPublishedPolicy(), [], LIVE_POLL_MS * 2)
export const usePreview = (pollMs?: number) => {
  const key = useRulesKey()
  return useAsync<PublishPreview>(() => api.previewPublish(), [key], pollMs)
}

/** The household's rules, in policy order. Pass `onlyOn` to leave out rules the person switched off. */
export function useRules(onlyOn = false): Rule[] {
  const { household } = useHousehold()
  const all = household?.rules ?? []
  return onlyOn ? all.filter((r) => r.enabled) : all
}

/* ---------- household (devices in the home, preset and rules) ---------- */
interface Ctx {
  household: Household | null
  error: Error | null
  addDevice: (id: string, opts?: { joined?: boolean }) => Promise<void>
  removeDevice: (id: string) => Promise<void>
  saveForLater: (id: string) => Promise<void>
  markJoinedSeen: (id: string) => Promise<void>
  resetDemo: (mode: 'seed' | 'empty') => Promise<void>
  /** Loads the household again after a failed first load. */
  reload: () => void
  choosePreset: (p: { preset_id: string; answers?: Answers }) => Promise<void>
  saveProfile: (p: Profile) => Promise<void>
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

  const reload = useCallback(() => {
    setError(null)
    api.getHousehold().then(setHousehold, setError)
  }, [])
  useEffect(reload, [reload])
  // Devices that register with the PPD gateway join the home on their own; look for them now and then.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') api.getHousehold().then(setHousehold, () => undefined)
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const toast = useCallback((text: string) => {
    setMessage(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 2600)
  }, [])

  // A failed change leaves the household as it was and says so; the person can try again.
  const run = useCallback(<A extends unknown[]>(fn: (...a: A) => Promise<Household>) => async (...a: A) => {
    try { setHousehold(await fn(...a)) } catch (e) { toast(`Not saved. ${(e as Error).message}`) }
  }, [toast])

  const value = useMemo<Ctx>(() => ({
    household, error, toast, reload,
    addDevice: run(api.addDevice), removeDevice: run(api.removeDevice), saveForLater: run(api.saveForLater),
    markJoinedSeen: run(api.markJoinedSeen), resetDemo: run(api.resetDemo),
    choosePreset: run(api.choosePreset), saveProfile: run(api.saveProfile), upsertRule: run(api.upsertRule), deleteRule: run(api.deleteRule),
  }), [household, error, toast, reload, run])

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
