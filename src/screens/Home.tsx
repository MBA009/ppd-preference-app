import { Link } from 'react-router-dom'
import { AppBar, Cell, DeviceTile, Group, SectionHeader, Tile, VerdictChip, VerdictChips, Loading, ErrorBox } from '../components/ui'
import { DashedCircle, Icon, SmallCheck } from '../components/icons'
import { useDevices, useHousehold } from '../state/data'
import { countVerdicts, pendingFlows, plural } from '../lib/verdicts'
import { stateLabel } from '../lib/device'

export default function Home() {
  const { household, error } = useHousehold()
  const ids = household?.devices.map((d) => d.device_id) ?? []
  const { data: devices, error: loadError, loading } = useDevices(ids)

  if (error || loadError) return <><AppBar title="My home" /><ErrorBox error={(error ?? loadError)!} /></>
  if (!household || (loading && ids.length > 0 && !devices)) return <><AppBar title="My home" /><Loading /></>

  const list = devices ?? []
  const waiting = list.map((d) => ({ d, n: pendingFlows(d, household).length })).filter((x) => x.n > 0)
  const totalWaiting = waiting.reduce((s, x) => s + x.n, 0)
  const updating = list.filter((d) => d.declaration?.state === 'waiting_for_renewal').length
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
                  <span className="ttl">{d.short_name}</span>
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

export function DecisionGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" /><path d="M7 4v3.3" /><circle cx="7" cy="10" r=".7" fill="currentColor" />
    </svg>
  )
}

