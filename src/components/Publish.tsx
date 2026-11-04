import { LIVE_POLL_MS, usePreview } from '../state/data'
import { Cell, Footnote, Group, Tile } from './ui'
import { Icon, ShieldCheck } from './icons'
import { plural } from '../lib/verdicts'
import { timeAgo } from '../lib/device'


/**
 * Whether the household policy has reached the devices. app-api compiles the household's rules into one PPD policy
 * of atomic allow/deny policy rules, one per core dataflow the household policy answers (up to 6,272), the same for
 * every device, and sends it on its own whenever the rules change; the gateway serves it, and devices fetch and
 * confirm it. The full policy is on the JSON page.
 */

export function PublishCard() {
  const preview = usePreview(LIVE_POLL_MS)
  const p = preview.data

  if (preview.error && !p) {
    return (
      <Group style={{ marginBottom: 12 }}>
        <Cell className="t" chevron={false} to="/status">
          <Tile tone="grey"><Icon name="publish" size={18} /></Tile>
          <div className="cb"><span className="ttl">Your devices can’t get your household policy right now</span><span className="sub">{preview.error.message}</span></div>
        </Cell>
      </Group>
    )
  }
  if (!p) return null

  // app-api sends on its own (server/src/autopublish.ts); this card only says how that is going.
  const changes = p.changes ?? p.rules.filter((r) => r.change !== 'unchanged').length + p.removed.length
  const sent = p.sync?.last_sent
  const error = p.sync?.last_error
  const pending = changes > 0 && p.devices > 0

  const title = !p.devices ? 'No connected devices yet' : pending ? 'Sending your household policy to your devices…' : 'Your devices have your latest household policy'
  const sub = !p.devices
    ? 'When a device that supports PPD joins your home, it gets your rules automatically.'
    : pending
      ? error ? `Not sent yet: ${error} Trying again.` : `${plural(changes, 'change')}, going out within a few seconds.`
      : `${plural(p.devices, 'device')}${sent ? ` · sent automatically ${timeAgo(sent.at)}` : ''}. New devices get them on their own.`

  return (
    <>
      <Group style={{ marginBottom: 4 }}>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={pending ? 'blue' : 'green'} style={{ marginTop: 10 }}>{pending ? <Icon name="publish" size={18} /> : <ShieldCheck />}</Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{title}</span>
            <span className="sub">{sub}</span>
          </div>
        </Cell>
      </Group>
      {p.warnings.map((w) => <Footnote key={w}>{w}</Footnote>)}
    </>
  )
}
