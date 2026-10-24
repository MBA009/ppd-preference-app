import { useState } from 'react'
import type { PolicyRule } from '../api'
import { LIVE_POLL_MS, useDevices, useHousehold, usePreview, usePublished } from '../state/data'
import { PROCESSING_BOUNDARY, RETENTION, termLabel } from '../../shared/taxonomy'
import { Cell, Expander, Footnote, Group, SectionHeader, Tile } from './ui'
import { Icon, ShieldCheck } from './icons'
import { plural } from '../lib/verdicts'
import { timeAgo } from '../lib/device'

/**
 * The household rules on their way to the devices. app-api compiles the rules into one PPD household policy
 * of atomic allow/deny rules, one per dataflow a connected device declared, and sends it on its own whenever
 * the rules or the devices change; the gateway serves it, and devices fetch and confirm it.
 */

/** "Allow · What sensors notice · Making a feature work · Sent to the maker" */
export function ruleText(r: PolicyRule): string {
  const parts = [termLabel('data_type', r.data_type), termLabel('purpose', r.purpose).toLowerCase(), `${termLabel('action', r.action).toLowerCase()} · ${termLabel('handling_context', r.handling_context).toLowerCase()}`]
  const kept = r.constraints?.retention ? ` · kept: ${RETENTION[r.constraints.retention]?.toLowerCase() ?? r.constraints.retention}` : ''
  const boundary = r.constraints?.processing_boundary ? ` · ${PROCESSING_BOUNDARY[r.constraints.processing_boundary]?.toLowerCase() ?? r.constraints.processing_boundary}` : ''
  const where = r.constraints?.jurisdiction ? ` · only in ${(r.constraints.jurisdiction.countrycode ?? []).join(', ').toUpperCase()}` : ''
  return parts.join(' · ') + kept + boundary + where
}

export function PublishCard() {
  const preview = usePreview(LIVE_POLL_MS)
  const p = preview.data

  if (preview.error && !p) {
    return (
      <Group style={{ marginBottom: 12 }}>
        <Cell className="t" chevron={false} to="/status">
          <Tile tone="grey"><Icon name="publish" size={18} /></Tile>
          <div className="cb"><span className="ttl">Your devices can’t get your rules right now</span><span className="sub">{preview.error.message}</span></div>
        </Cell>
      </Group>
    )
  }
  if (!p) return null

  // app-api sends on its own (server/src/autopublish.ts); this card only says how that is going.
  const changes = p.rules.filter((r) => r.change !== 'unchanged').length + p.removed.length
  const sent = p.sync?.last_sent
  const error = p.sync?.last_error
  const pending = changes > 0 && p.devices > 0

  const title = !p.devices ? 'No connected devices yet' : pending ? 'Sending your rules to your devices…' : 'Your devices have your latest rules'
  const sub = !p.devices
    ? 'When a device that supports PPD joins your home, it gets your rules automatically.'
    : pending
      ? error ? `Not sent yet: ${error} Trying again.` : `${plural(changes, 'change')}, going out within a few seconds.`
      : `${plural(p.rules.length, 'rule')} for ${plural(p.devices, 'device')}${sent ? ` · sent automatically ${timeAgo(sent.at)}` : ''}. New devices get them on their own.`

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

/** The rules the gateway serves right now, in plain language. */
export function PublishedRules() {
  const { data: policy } = usePublished()
  const { data: preview } = usePreview(LIVE_POLL_MS)
  const { household } = useHousehold()
  const { data: devices } = useDevices(household?.devices.map((d) => d.device_id) ?? [])
  const [open, setOpen] = useState<string | null>(null)
  if (!policy) return null

  // Which device flows each sent rule covers, from the compile (same rule ids: one per exact dataflow).
  const flowsOf = new Map((preview?.rules ?? []).map((r) => [r.rule_id, r.flows]))
  const name = (id: string) => devices?.find((d) => d.id === id)?.short_name ?? id
  const byDevice = new Map<string, { rule: PolicyRule; titles: string[] }[]>()
  for (const rule of policy.rules) {
    const flows = flowsOf.get(rule.rule_id) ?? []
    for (const id of new Set(flows.map((f) => f.device_id))) {
      const list = byDevice.get(id) ?? []
      list.push({ rule, titles: flows.filter((f) => f.device_id === id).map((f) => f.title) })
      byDevice.set(id, list)
    }
  }
  const sent = preview?.sync?.last_sent?.policy_id === policy.policy_id ? preview.sync.last_sent.at : null
  const toggle = (key: string) => setOpen(open === key ? null : key)

  return (
    <>
      <SectionHeader>What your devices receive</SectionHeader>
      <Group>
        <div className="cell">
          <div className="cb">
            <span className="ttl">Current policy · {plural(policy.rules.length, 'rule')}</span>
            <span className="sub mono" style={{ fontSize: 12 }}>{policy.policy_id}{sent ? ` · sent ${timeAgo(sent)}` : ''}</span>
          </div>
        </div>
        {[...byDevice.entries()].map(([id, list]) => {
          const never = list.filter((x) => x.rule.effect === 'deny').length
          return (
            <div key={id}>
              <Expander open={open === id} onToggle={() => toggle(id)} sub={`${plural(list.length, 'rule')} apply${never ? ` · ${never} never` : ''}`}>{name(id)}</Expander>
              {open === id && list.sort((a, b) => (a.rule.effect === b.rule.effect ? 0 : a.rule.effect === 'deny' ? -1 : 1)).map(({ rule, titles }) => (
                <div key={rule.rule_id} className="cell" style={{ paddingLeft: 32 }}>
                  <div className="cb">
                    <span className="ttl" style={{ color: rule.effect === 'deny' ? '#B3261E' : '#1E7D34', fontWeight: 500, fontSize: 14 }}>{rule.effect === 'deny' ? 'Never' : 'Allowed'}{limitText(rule)}</span>
                    <span className="sub">{titles.join(' · ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        <Expander open={open === 'all'} onToggle={() => toggle('all')} sub="As the gateway and the CableLabs dashboard show them">{`All ${policy.rules.length} rules in PPD terms`}</Expander>
        {open === 'all' && policy.rules.map((r) => (
          <div key={r.rule_id} className="cell">
            <div className="cb"><span className="ttl" style={{ color: r.effect === 'deny' ? '#B3261E' : '#1E7D34', fontWeight: 500 }}>{r.effect === 'deny' ? 'Never' : 'Allowed'} <span className="sub mono" style={{ fontWeight: 400 }}>{r.rule_id}</span></span><span className="sub">{ruleText(r)}</span></div>
          </div>
        ))}
      </Group>
      <Footnote>Every device gets the whole policy and follows the rules that match what it does. Each rule covers one exact kind of data flow, so a device can check it directly; we can’t check that devices follow them.</Footnote>
    </>
  )
}

/** A household limit a rule carries (protocol-04 section 7.12), as " · only if …". */
function limitText(r: PolicyRule): string {
  if (r.effect !== 'allow') return ''
  if (r.constraints?.processing_boundary === 'ppd:inHomeOnly') return ' · only if processed in your home'
  if (r.constraints?.processing_boundary === 'ppd:onDeviceOnly') return ' · only if it stays on the device'
  if (r.constraints?.retention === 'ppd:ephemeral') return ' · only if not kept'
  return ''
}
