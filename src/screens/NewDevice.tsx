import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ActionBar, AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader, Tile } from '../components/ui'
import { FlowRow, ProvenanceCard, nounOf } from '../components/DeviceReport'
import { Icon } from '../components/icons'
import { useDevice, useHousehold, useRules } from '../state/data'
import { needsAttention } from '../lib/verdicts'
import { timeAgo } from '../lib/device'

/** Screen 2a: a device that supports PPD joined the home and sent its declaration. */
export default function NewDevice() {
  const { id } = useParams()
  const { household, markJoinedSeen } = useHousehold()
  const dev = useDevice(id)
  const rules = useRules(true)
  const entry = household?.devices.find((h) => h.device_id === id)

  useEffect(() => {
    if (entry && entry.joined_seen === false) void markJoinedSeen(entry.device_id)
  }, [entry, markJoinedSeen])

  if (dev.error) return <><AppBar title="New device" back="/" /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="New device" /><Loading /></>
  if (!entry || d.source !== 'declared') return <Navigate to={`/device/${id}`} replace />

  const conflicts = d.flows.filter(needsAttention)
  const rest = conflicts.slice(3)
  const others = d.flows.length - conflicts.length
  const ruleCount = rules.length

  return (
    <div className="screen">
      <AppBar title="New device" right={<Link to="/" className="ntr">Done</Link>} />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="green" style={{ marginTop: 12 }}><Icon name="check" size={20} /></Tile>
          <div className="cb">
            <span className="ttl" style={{ fontWeight: 500 }}>{d.short_name} joined your home</span>
            <span className="sub">It registered {timeAgo(entry.added_at)} and sent its declaration.</span>
          </div>
        </Cell>
      </Group>
      <div className="gap" />
      <ProvenanceCard device={d} ruleCount={ruleCount} sub={`${d.category_label} · Gets your rules`} stacked />
      <div className="sf">
        <b>Nothing was changed on {nounOf(d)}.</b> These verdicts compare what it says it does with your rules. The app can’t switch anything on or off in the device, or check that it follows your rules.
      </div>

      {conflicts.length > 0 && (
        <>
          <SectionHeader>Conflicts with your rules · {conflicts.length}</SectionHeader>
          <Group>
            {conflicts.slice(0, 3).map((f) => <FlowRow key={f.id} device={d} flow={f} />)}
            {rest.length > 0 && (
              <Cell to={`/device/${d.id}`}>
                <div className="cb"><span className="sub">{rest.length} more: {rest.length <= 2 ? rest.map((f) => f.title.toLowerCase()).join(' and ') : 'see them all on the device'}</span></div>
              </Cell>
            )}
          </Group>
          <Footnote>Your rules say no to these, and the device is told so. There is nothing you need to decide. To allow one, change your rules.</Footnote>
        </>
      )}
      {others > 0 && (
        <>
          <div className="gap" />
          <Group><Cell chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="ttl" style={{ fontSize: 15, lineHeight: '20px', color: '#0066CC' }}>{others} other {others === 1 ? 'flow matches' : 'flows are fine'}</span></div></Cell></Group>
        </>
      )}

      <div className="spacer" />
      <ActionBar>
        <Link to={`/device/${d.id}`} className="btn2">See the device</Link>
        <Link to="/" className="btn">Done</Link>
      </ActionBar>
    </div>
  )
}
