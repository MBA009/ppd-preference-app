import { Link } from 'react-router-dom'
import { AppBar, Cell, DeviceTile, Footnote, Group, SectionHeader, Tile, VerdictChip, VerdictChips, Loading, ErrorBox } from '../components/ui'
import { DashedCircle, Icon, SmallCheck } from '../components/icons'
import { useDevices, useHousehold, useOverview, useUnmanaged } from '../state/data'
import { countVerdicts, pendingFlows, plural } from '../lib/verdicts'
import { hasRules, isConnected, stateLabel } from '../lib/device'
import type { Device, Household, Overview, UnmanagedDevice } from '../api'

/**
 * Screen 3a. Three kinds of device, kept apart:
 * - connected through PPD: registered with the home gateway, they get the household rules. Split into those that
 *   hold the rules now and those that need attention (not confirmed, stale, unplugged, reconnecting, conflicting);
 * - on the network without PPD: the router sees them ("unmanaged"), they can't get the rules;
 * - advisory devices the household added from the research library: advice only.
 */
export default function Home() {
  const { household, error } = useHousehold()
  const ids = household?.devices.map((d) => d.device_id) ?? []
  const { data: devices, error: loadError, loading } = useDevices(ids, true)
  const { data: overview } = useOverview()
  const { data: unmanaged } = useUnmanaged()

  if (error || (loadError && !devices)) return <><AppBar title="My home" /><ErrorBox error={(error ?? loadError)!} /></>
  if (!household || (loading && ids.length > 0 && !devices)) return <><AppBar title="My home" /><Loading /></>

  const list = devices ?? []
  const connected = list.filter(isConnected)
  const advisory = list.filter((d) => !isConnected(d))
  const withRules = connected.filter(hasRules)
  const attentionDevices = connected.filter((d) => !hasRules(d))
  const waiting = list.map((d) => ({ d, n: pendingFlows(d, household).length })).filter((x) => x.n > 0)
  const totalWaiting = waiting.reduce((s, x) => s + x.n, 0)
  const updating = connected.filter((d) => d.live?.publication === 'waiting').length
  const unseen = household.devices.find((h) => h.joined_seen === false && connected.some((d) => d.id === h.device_id))
  const first = waiting[0]?.d

  const bannerTo = unseen ? `/device/${unseen.device_id}/joined` : first ? `/device/${first.id}` : undefined
  const joinedName = unseen ? connected.find((d) => d.id === unseen.device_id)?.short_name : undefined
  const bannerTitle = joinedName ? `${joinedName} joined your home` : totalWaiting > 0 ? `${plural(totalWaiting, 'decision')} waiting` : 'Rules are updating'
  const bannerSub = [first ? first.short_name + (waiting.length > 1 ? ` and ${waiting.length - 1} more` : '') + ' · decisions waiting' : null, updating ? `${plural(updating, 'device is', 'devices are')} picking up a rule change` : null].filter(Boolean).join(' · ')

  return (
    <div className="screen">
      <AppBar title="My home" right={<Link to="/library" className="ntr" aria-label="Add a device"><Icon name="plus" /></Link>} />

      {(unseen || totalWaiting > 0 || updating > 0) && (
        <Group style={{ marginTop: 4 }}>
          <Cell className="t" to={bannerTo} chevron={!!bannerTo}>
            <Tile tone={unseen ? 'blue' : 'orange'}>{unseen ? <Icon name="plus" size={18} /> : <DecisionGlyph />}</Tile>
            <div className="cb">
              <span className="ttl" style={{ fontWeight: 500 }}>{bannerTitle}</span>
              <span className="sub">{bannerSub || 'See what it does with your data'}</span>
            </div>
          </Cell>
        </Group>
      )}

      {overview && <Readiness overview={overview} />}

      {connected.length === 0 && (
        <>
          <SectionHeader>Connected through PPD · 0</SectionHeader>
          <Group><div className="empty">No device has connected yet. Devices that support PPD join by themselves when they connect to your network.</div></Group>
        </>
      )}

      {attentionDevices.length > 0 && (
        <>
          <SectionHeader>Need attention · {attentionDevices.length}</SectionHeader>
          <Group>{attentionDevices.map((d) => <DeviceRow key={d.id} device={d} household={household} />)}</Group>
          <Footnote>These devices connected through PPD but don’t hold your current rules: they haven’t confirmed them yet, stopped renewing, or need to reconnect. A device that has left for good can be forgotten from its page.</Footnote>
        </>
      )}

      {withRules.length > 0 && (
        <>
          <SectionHeader>Have your rules · {withRules.length}</SectionHeader>
          <Group>{withRules.map((d) => <DeviceRow key={d.id} device={d} household={household} />)}</Group>
        </>
      )}

      {overview?.gateway.reachable && (
        <>
          <SectionHeader>On your network, no PPD · {unmanaged?.length ?? 0}</SectionHeader>
          {unmanaged && unmanaged.length > 0 ? (
            <Group>{unmanaged.map((u) => <UnmanagedRow key={u.id} device={u} />)}</Group>
          ) : (
            <Group><div className="empty" style={{ padding: 20 }}>Your home gateway hasn’t seen any device that doesn’t support PPD.</div></Group>
          )}
          <Footnote>These devices are on your home network but don’t support PPD, so your rules can’t reach them.</Footnote>
        </>
      )}

      {advisory.length > 0 && (
        <>
          <SectionHeader>Advisory devices you added · {advisory.length}</SectionHeader>
          <Group>{advisory.map((d) => <DeviceRow key={d.id} device={d} household={household} />)}</Group>
          <Footnote>From our research. Nothing is sent to these devices.</Footnote>
        </>
      )}

      <div className="gap" />
      <Group>
        <Cell className="t" to="/library">
          <Tile tone="blue"><Icon name="plus" size={18} /></Tile>
          <div className="cb">
            <span className="ttl" style={{ color: '#0066CC' }}>Add a device</span>
            <span className="sub">Scan its code or pick it from our research library</span>
          </div>
        </Cell>
      </Group>
      <Footnote>Devices that support PPD join by themselves when they connect to your network.</Footnote>
      <div className="spacer" />
    </div>
  )
}

function DeviceRow({ device: d, household }: { device: Device; household: Household }) {
  const counts = countVerdicts(d, household)
  const attention = (['unsatisfiable', 'decision_required', 'indeterminate'] as const).some((v) => counts[v])
  return (
    <Cell className="d" to={`/device/${d.id}`}>
      <DeviceTile device={d} />
      <div className="cb">
        <span className="ttl">{d.short_name}{d.kind === 'simulated' && <span className="tag" style={{ marginLeft: 8 }}>Simulated</span>}</span>
        <span className="st">
          {hasRules(d) ? <SmallCheck /> : <DashedCircle />}
          <span>{d.live && !hasRules(d) ? d.live.association.label : stateLabel(d)}</span>
        </span>
        <span className="ln">
          {attention ? <VerdictChips counts={counts} order={['unsatisfiable', 'decision_required', 'indeterminate']} /> : <VerdictChip verdict="compatible" n={(counts.compatible ?? 0) + (counts.conditionally_satisfiable ?? 0)} />}
        </span>
      </div>
    </Cell>
  )
}

function UnmanagedRow({ device: u }: { device: UnmanagedDevice }) {
  const guess = [u.likely_vendor, u.likely_type].filter(Boolean).join(' ')
  const inner = (
    <>
      <Tile tone="grey" size="device"><Icon name="status" size={20} /></Tile>
      <div className="cb">
        <span className="ttl">{u.hostname ?? 'Unnamed device'}{u.simulated && <span className="tag" style={{ marginLeft: 8 }}>Simulated</span>}</span>
        <span className="sub">{[u.ip_address, guess || null].filter(Boolean).join(' · ')}</span>
        <span className="sub" style={{ fontSize: 13 }}>{u.research_match ? `Looks like ${u.research_match.short_name} · see what it does` : 'Doesn’t support PPD · doesn’t get your rules'}</span>
      </div>
    </>
  )
  return u.research_match ? <Cell className="d" to={`/device/${encodeURIComponent(u.research_match.id)}`}>{inner}</Cell> : <Cell className="d" chevron={false}>{inner}</Cell>
}

/** The CableLabs dashboard's four counts, in plain words and computed the same way. */
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
  const stats: [string, number, string | undefined][] = [
    ['On your network', c.known, undefined],
    ['Have your rules', c.associated, 'ok'],
    ['Don’t support PPD', c.unmanaged, undefined],
    ['Need attention', c.need_attention, c.need_attention ? 'dec' : undefined],
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
