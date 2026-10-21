import { Link } from 'react-router-dom'
import { AppBar, Cell, DeviceTile, Group, SectionHeader, Tile, VerdictChip, VerdictChips, Loading, ErrorBox } from '../components/ui'
import { DashedCircle, Icon, SmallCheck } from '../components/icons'
import { useDevices, useHousehold, useOverview } from '../state/data'
import { countVerdicts, pendingFlows, plural } from '../lib/verdicts'
import { stateLabel } from '../lib/device'
import type { Overview } from '../api'

export default function Home() {
  const { household, error } = useHousehold()
  const ids = household?.devices.map((d) => d.device_id) ?? []
  const { data: devices, error: loadError, loading } = useDevices(ids, true)
  const { data: overview } = useOverview()

  if (error || (loadError && !devices)) return <><AppBar title="My home" /><ErrorBox error={(error ?? loadError)!} /></>
  if (!household || (loading && ids.length > 0 && !devices)) return <><AppBar title="My home" /><Loading /></>

  const list = devices ?? []
  const waiting = list.map((d) => ({ d, n: pendingFlows(d, household).length })).filter((x) => x.n > 0)
  const totalWaiting = waiting.reduce((s, x) => s + x.n, 0)
  const updating = list.filter((d) => d.declaration?.state === 'waiting_for_renewal' || d.live?.publication === 'waiting').length
  const unseen = household.devices.find((h) => h.joined_seen === false)
  const first = waiting[0]?.d

  const bannerTo = unseen && list.some((d) => d.id === unseen.device_id) ? `/device/${unseen.device_id}/joined` : first ? `/device/${first.id}` : undefined
  const bannerSub = [first ? first.short_name + (waiting.length > 1 ? ` and ${waiting.length - 1} more` : '') : null, updating ? `${plural(updating, 'device is', 'devices are')} picking up a rule change` : null].filter(Boolean).join(' · ')

  return (
    <div className="screen">
      <AppBar title="My home" right={<Link to="/library" className="ntr" aria-label="Add a device"><Icon name="plus" /></Link>} />

      {(totalWaiting > 0 || updating > 0) && (
        <Group style={{ marginTop: 4 }}>
          <Cell className="t" to={bannerTo} chevron={!!bannerTo}>
            <Tile tone="orange"><DecisionGlyph /></Tile>
            <div className="cb">
              <span className="ttl" style={{ fontWeight: 500 }}>{totalWaiting > 0 ? `${plural(totalWaiting, 'decision')} waiting` : 'Rules are updating'}</span>
              <span className="sub">{bannerSub}</span>
            </div>
          </Cell>
        </Group>
      )}

      {overview && <Readiness overview={overview} />}

      <SectionHeader>Devices · {list.length}</SectionHeader>
      {list.length > 0 ? (
        <Group>
          {list.map((d) => {
            const counts = countVerdicts(d, household)
            const attention = (['unsatisfiable', 'decision_required', 'indeterminate'] as const).some((v) => counts[v])
            return (
              <Cell key={d.id} className="d" to={`/device/${d.id}`}>
                <DeviceTile device={d} />
                <div className="cb">
                  <span className="ttl">{d.short_name}{d.kind === 'simulated' && <span className="tag" style={{ marginLeft: 8 }}>Simulated</span>}</span>
                  <span className="st">
                    {d.declaration?.state === 'rules_confirmed' ? <SmallCheck /> : <DashedCircle />}
                    <span>{stateLabel(d)}</span>
                  </span>
                  <span className="ln">
                    {attention ? <VerdictChips counts={counts} order={['unsatisfiable', 'decision_required', 'indeterminate']} /> : <VerdictChip verdict="compatible" n={(counts.compatible ?? 0) + (counts.conditionally_satisfiable ?? 0)} />}
                  </span>
                </div>
              </Cell>
            )
          })}
        </Group>
      ) : (
        <Group>
          <div className="empty">No devices yet. Scan the box of a device, or pick one from the library.</div>
        </Group>
      )}

      <div className="gap" />
      <Group>
        <Cell className="t" to="/library">
          <Tile tone="blue"><Icon name="plus" size={18} /></Tile>
          <div className="cb">
            <span className="ttl" style={{ color: '#0066CC' }}>Add a device</span>
            <span className="sub">Pick from library or connect to a new device</span>
          </div>
        </Cell>
      </Group>
      <div className="spacer" />
    </div>
  )
}

/** The gateway's readiness summary (the CableLabs dashboard's "Network Privacy Readiness"). */
function Readiness({ overview: o }: { overview: Overview }) {
  const c = o.counts
  if (!o.gateway.reachable) {
    return (
      <Group style={{ marginTop: 8 }}>
        <Cell className="t" to="/status">
          <Tile tone="grey"><Icon name="status" size={18} /></Tile>
          <div className="cb"><span className="ttl">Home gateway not reachable</span><span className="sub">Devices that get your rules can’t be checked right now</span></div>
        </Cell>
      </Group>
    )
  }
  const attention = c.needs_reassociation + c.stale + c.broken + c.policy_conflict
  const stats: [string, number, string?][] = [
    ['Connected', c.known],
    ['Confirmed your rules', c.associated, 'ok'],
    ['Need attention', attention, attention ? 'dec' : undefined],
    ['With device exceptions', c.overrides],
  ]
  return (
    <>
      <SectionHeader>Privacy readiness</SectionHeader>
      <Group>
        <div className="stats">
          {stats.map(([label, n, cls]) => (
            <div key={label} className="stat"><span className={'n ' + (cls ?? '')}>{n}</span><span className="sub">{label}</span></div>
          ))}
        </div>
        <Cell className="t" to="/status">
          <Tile tone={o.gateway.security === 'direct-certificate' ? 'green' : 'grey'}><Icon name="status" size={18} /></Tile>
          <div className="cb">
            <span className="ttl">System status</span>
            <span className="sub">{o.gateway.security === 'direct-certificate' ? 'Devices prove who they are with certificates' : 'Prototype mode: devices are not authenticated'}{o.household_policy.policy_id ? ` · rules ${o.household_policy.policy_id}` : ''}</span>
          </div>
        </Cell>
      </Group>
    </>
  )
}

export function DecisionGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4v3.3" /><circle cx="7" cy="10" r=".7" fill="currentColor" />
    </svg>
  )
}

