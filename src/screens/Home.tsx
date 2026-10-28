import { AppBar, Cell, DeviceTile, Footnote, Group, SectionHeader, Tile, VerdictChip, VerdictChips, Loading, ErrorBox } from '../components/ui'
import { DashedCircle, Icon, SmallCheck } from '../components/icons'
import { useDevices, useHousehold, useOverview, useUnmanaged } from '../state/data'
import { countVerdicts, plural } from '../lib/verdicts'
import { hasRules, isConnected, stateLabel, timeAgo } from '../lib/device'
import type { Device, Overview, UnmanagedDevice } from '../api'

type Notice = { key: string; tone: 'red' | 'orange' | 'blue'; icon: 'status' | 'plus' | 'publish'; title: string; sub: string; to?: string }

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
  const unseen = household.devices.find((h) => h.joined_seen === false && connected.some((d) => d.id === h.device_id))
  const status = (d: Device) => d.live?.association.status
  const reported = (d: Device) => !!d.live?.runtime.conflict_active || status(d) === 'policy_conflict'
  const stale = connected.filter((d) => status(d) === 'stale_association')
  const reconnect = connected.filter((d) => status(d) === 'needs_reassociation' || status(d) === 'broken')
  // One notice per device: a device that lost touch says so, and mentions a conflict it reported before.
  // Only devices still in touch are "updating": a device that stopped checking in is not about to pick anything up.
  const lost = new Set([...stale, ...reconnect].map((d) => d.id))
  const conflicting = connected.filter((d) => reported(d) && !lost.has(d.id))
  const earlier = (list: Device[]) => list.length === 1 && reported(list[0]) ? ' Before that, it reported sending data against your rules.' : ''
  const updating = connected.filter((d) => d.live?.publication === 'waiting' && !lost.has(d.id)).length
  const joined = unseen && connected.find((d) => d.id === unseen.device_id)

  const names = (list: Device[]) => list.length === 1 ? list[0].short_name : `${list.length} devices`
  const lastSeen = (d: Device) => (d.live?.receipt?.acknowledged_at ? ` since ${timeAgo(d.live.receipt.acknowledged_at)}` : '')
  const to = (list: Device[]) => (list.length === 1 ? `/device/${encodeURIComponent(list[0].id)}` : undefined)

  // Every notice on My home, most urgent first. Each says what happened and what to do; the device lists below have
  // the detail.
  const notices: Notice[] = [
    conflicting.length > 0 && {
      key: 'conflict', tone: 'red', icon: 'status', to: to(conflicting),
      title: `${names(conflicting)} ${conflicting.length === 1 ? 'is' : 'are'} doing something your rules don’t allow`,
      sub: conflicting.length === 1 ? 'See what it is doing' : conflicting.map((d) => d.short_name).join(', '),
    },
    stale.length > 0 && {
      key: 'stale', tone: stale.some(reported) ? 'red' : 'orange', icon: 'status', to: to(stale),
      title: `${names(stale)} stopped checking in`,
      sub: stale.length === 1
        ? `It hasn’t confirmed your rules${lastSeen(stale[0])}. It may be unplugged or offline, and gets your rules again when it’s back.${earlier(stale)}`
        : `${stale.map((d) => d.short_name).join(', ')}. They may be unplugged or offline.`,
    },
    reconnect.length > 0 && {
      key: 'reconnect', tone: reconnect.some(reported) ? 'red' : 'orange', icon: 'status', to: to(reconnect),
      title: `${names(reconnect)} ${reconnect.length === 1 ? 'needs' : 'need'} to reconnect`,
      sub: `${reconnect.length === 1 ? 'It' : 'They'} can’t get your rules until ${reconnect.length === 1 ? 'it joins' : 'they join'} again.${earlier(reconnect)}`,
    },
    !!joined && {
      key: 'joined', tone: 'blue', icon: 'plus', to: `/device/${encodeURIComponent(joined.id)}/joined`,
      title: `${joined.short_name} joined your home`, sub: 'See what it does with your data',
    },
    updating > 0 && {
      key: 'updating', tone: 'blue', icon: 'publish',
      title: 'Rules are updating', sub: `${plural(updating, 'device is', 'devices are')} picking up your latest rule change. This takes a minute or two.`,
    },
  ].filter((n): n is Notice => !!n)

  return (
    <div className="screen">
      <AppBar title="My home" />

      {notices.length > 0 && (
        <Group style={{ marginTop: 4 }}>
          {notices.map((n) => (
            <Cell key={n.key} className="t" to={n.to} chevron={!!n.to} style={{ alignItems: 'flex-start' }}>
              <Tile tone={n.tone} style={{ marginTop: 10 }}><Icon name={n.icon} size={18} /></Tile>
              <div className="cb">
                <span className="ttl" style={{ fontWeight: 500 }}>{n.title}</span>
                <span className="sub">{n.sub}</span>
              </div>
            </Cell>
          ))}
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
          <Group>{attentionDevices.map((d) => <DeviceRow key={d.id} device={d} />)}</Group>
          <Footnote>These devices connected through PPD but don’t hold your current rules: they haven’t confirmed them yet, stopped renewing, or need to reconnect. A device that has left for good can be forgotten from its page.</Footnote>
        </>
      )}

      {withRules.length > 0 && (
        <>
          <SectionHeader>Have your rules · {withRules.length}</SectionHeader>
          <Group>{withRules.map((d) => <DeviceRow key={d.id} device={d} />)}</Group>
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
          <Group>{advisory.map((d) => <DeviceRow key={d.id} device={d} />)}</Group>
          <Footnote>From our research. Nothing is sent to these devices.</Footnote>
        </>
      )}

      <div className="gap" />
      <Group>
        <Cell className="t" to="/library">
          <Tile tone="blue"><Icon name="search" size={18} /></Tile>
          <div className="cb">
            <span className="ttl" style={{ color: '#0066CC' }}>Check a device before you buy it</span>
            <span className="sub">See how what it says it does fits your rules. Scan its privacy code, or look it up in our research library.</span>
          </div>
        </Cell>
      </Group>
      <Footnote>This checks what the device declares, not what it will actually do. You don’t need to add devices you own: devices that support PPD join and get your rules by themselves when they connect to your network.</Footnote>
      <div className="spacer" />
    </div>
  )
}

function DeviceRow({ device: d }: { device: Device }) {
  const counts = countVerdicts(d)
  const attention = !!counts.unsatisfiable
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
          {attention ? <VerdictChips counts={counts} order={['unsatisfiable']} /> : <VerdictChip verdict="compatible" n={(counts.compatible ?? 0) + (counts.conditionally_satisfiable ?? 0)} />}
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
    ['Have your rules', c.have_rules, 'ok'],
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
