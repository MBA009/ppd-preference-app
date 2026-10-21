import type { HealthCheck } from '../api'
import { AppBar, ErrorBox, Footnote, Group, Loading, SectionHeader } from '../components/ui'
import { useMe, useOverview, useSystemStatus } from '../state/data'
import { timeAgo } from '../lib/device'

/** The CableLabs service-health page and gateway summary, in the app: is everything the demo needs working? */

const GROUPS: { group: HealthCheck['group']; title: string }[] = [
  { group: 'app', title: 'This app' },
  { group: 'gateway', title: 'Gateway checks' },
  { group: 'repository', title: 'Rules store checks' },
]
const STATUS = { pass: { cls: 'ok', label: 'OK' }, warn: { cls: 'dec', label: 'Check' }, fail: { cls: 'bad', label: 'Failing' } } as const

export default function SystemStatus() {
  const status = useSystemStatus()
  const { data: o } = useOverview()
  const { data: me } = useMe()

  if (status.error && !status.data) return <><AppBar title="System status" back="/" /><ErrorBox error={status.error} /></>
  if (!status.data) return <><AppBar title="System status" back="/" /><Loading /></>

  const checks = status.data.checks
  const failing = checks.filter((c) => c.status === 'fail').length
  const warnings = checks.filter((c) => c.status === 'warn').length

  return (
    <div className="screen">
      <AppBar title="System status" back="/" />
      <div className="sf" style={{ paddingTop: 0 }}>
        {failing ? `${failing} ${failing === 1 ? 'check is' : 'checks are'} failing.` : warnings ? `Working, with ${warnings} ${warnings === 1 ? 'thing' : 'things'} to check.` : 'Everything is working.'} Updated {timeAgo(status.data.updated_at)}.
      </div>

      {o && (
        <>
          <SectionHeader>Gateway summary</SectionHeader>
          <Group>
            <div className="cell kv"><span className="ttl">Reachable</span><span className="v">{o.gateway.reachable ? 'Yes' : `No · ${o.gateway.error ?? ''}`}</span></div>
            <div className="cell kv"><span className="ttl">Device security</span><span className="v">{o.gateway.security === 'direct-certificate' ? 'Certificates (mutual TLS)' : o.gateway.security === 'unknown' ? 'Unknown' : 'Prototype (no device authentication)'}</span></div>
            <div className="cell kv"><span className="ttl">Receipts renew every</span><span className="v">{o.gateway.freshness_interval ?? 'Unknown'}</span></div>
            <div className="cell kv"><span className="ttl">Household rules served</span><span className="v mono">{o.household_policy.policy_id ?? 'None'}</span></div>
            <div className="cell kv"><span className="ttl">Sent from this app</span><span className="v">{o.household_policy.policy_id ? (o.household_policy.published_by_app ? 'Yes' : 'No (a preset or another tool)') : '—'}</span></div>
          </Group>
        </>
      )}

      {GROUPS.map((g) => {
        const list = checks.filter((c) => c.group === g.group)
        if (!list.length) return null
        return (
          <div key={g.group}>
            <SectionHeader>{g.title}</SectionHeader>
            <Group>
              {list.map((c) => (
                <div key={c.id} className="cell" style={{ alignItems: 'flex-start' }}>
                  <div className="cb">
                    <span className="ttl">{c.label}</span>
                    <span className="sub">{c.detail}</span>
                  </div>
                  <span className="tr" style={{ paddingTop: 12 }}><span className={`chip ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span></span>
                </div>
              ))}
            </Group>
          </div>
        )
      })}
      {me && <Footnote>Signed in as {me.email} · {me.role === 'operator' ? 'household operator' : 'viewer'}.</Footnote>}
      <div className="spacer" />
    </div>
  )
}
