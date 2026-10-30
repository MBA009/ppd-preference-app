import { useState, type ReactNode } from 'react'
import type { PolicyRule, Rule } from '../api'
import { LIVE_POLL_MS, useDevices, useHousehold, usePreview, usePublished, useRules } from '../state/data'
import { leavesHome, ruleCovers, strictness } from '../policy/scope'
import { PROCESSING_BOUNDARY, RETENTION, termLabel } from '../../shared/taxonomy'
import { Cell, Expander, Footnote, Group, SectionHeader, Tile } from './ui'
import { Icon, ShieldCheck } from './icons'
import { plural } from '../lib/verdicts'
import { KIND } from '../policy/choices'
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

/** The rules the gateway serves right now, in plain language. */
export function PublishedRules() {
  const { data: policy } = usePublished()
  const { data: preview } = usePreview(LIVE_POLL_MS)
  const { household } = useHousehold()
  const { data: devices } = useDevices(household?.devices.map((d) => d.device_id) ?? [])
  const rules = useRules()
  const [open, setOpen] = useState<string | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
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
  // How the counts relate: household rules in use → the flows they cover → exact rules, some shared by devices.
  const shared = new Set(policy.rules.filter((r) => new Set((flowsOf.get(r.rule_id) ?? []).map((f) => f.device_id)).size > 1).map((r) => r.rule_id))
  const flowCount = [...flowsOf.values()].reduce((n, f) => n + f.length, 0)
  // Rules that decide at least one flow: a rule a stricter one overrides on every flow it covers decides nothing.
  const decides = (r: Rule) => devices?.some((d) => d.flows.some((f) => ruleCovers({ ...r, enabled: true }, f.taxonomy)
    && !rules.some((o) => o.id !== r.id && strictness(o) > strictness(r) && ruleCovers(o, f.taxonomy))))
  const inUse = rules.filter(decides).length
  // Flows no rule covers fall to the compiler's default: allowed if they stay in the home, never if they leave it.
  const declared = (devices ?? []).filter((d) => byDevice.has(d.id)).flatMap((d) => d.flows)
  const uncovered = declared.filter((f) => !rules.some((r) => ruleCovers(r, f.taxonomy)))
  const leaving = uncovered.filter(leavesHome).length
  const deviceCount = byDevice.size === 1 ? 'your device declares' : `your ${byDevice.size} devices declare`
  const exact = (n: number) => `${n} exact ${n === 1 ? 'rule' : 'rules'}`
  const sent = preview?.sync?.last_sent?.policy_id === policy.policy_id ? preview.sync.last_sent.at : null
  const toggle = (key: string) => setOpen(open === key ? null : key)
  const em = (text: ReactNode, color?: string) => <b style={{ color, fontWeight: 600 }}>{text}</b>

  return (
    <>
      <SectionHeader>What your devices receive</SectionHeader>
      <div className="sf" style={{ paddingTop: 0, paddingBottom: 8 }}>
        {devices && byDevice.size > 0
          ? <>
              {uncovered.length
                ? <>{em(plural(inUse, 'household rule'))} {inUse === 1 ? 'covers' : 'cover'} {em(flowCount - uncovered.length, '#0066CC')} of the {em(plural(flowCount, 'data flow'))} {deviceCount}. No rule covers the other {em(uncovered.length, '#b45300')}, so the default decides them: {[uncovered.length - leaving && <span key="a">{em(uncovered.length - leaving, KIND.allow.color)} stay in your home and are <b style={{ color: KIND.allow.color }}>allowed</b></span>, leaving && <span key="d">{em(leaving, KIND.never.color)} leave it and are <b style={{ color: KIND.never.color }}>not</b></span>].filter(Boolean).flatMap((x, i) => (i ? [', ', x] : [x]))}. </>
                : <>{em(plural(inUse, 'household rule'))} {inUse === 1 ? 'covers' : 'cover'} the {em(plural(flowCount, 'data flow'))} {deviceCount}. </>}
              All of them are sent as {em(exact(policy.rules.length))}{shared.size ? ` (${shared.size} shared by more than one device)` : ''}. An exact rule covers one exact kind of data flow.
            </>
          : 'Your household rules, turned into one exact rule for each kind of data flow your devices declare.'}
      </div>
      <Group>
        <div className="cell">
          <div className="cb">
            <span className="ttl">Current policy · {exact(policy.rules.length)}</span>
            <span className="sub mono" style={{ fontSize: 12 }}>{policy.policy_id}{sent ? ` · sent ${timeAgo(sent)}` : ''}</span>
          </div>
        </div>
        {[...byDevice.entries()].map(([id, list]) => {
          const never = list.filter((x) => x.rule.effect === 'deny').length
          const limited = list.filter((x) => limitText(x.rule)).length
          const allowed = list.length - never - limited
          const parts = [never && `${never} never`, allowed && `${allowed} allowed`, limited && `${limited} allowed with a condition`].filter(Boolean)
          const both = list.filter((x) => shared.has(x.rule.rule_id)).length
          return (
            <div key={id}>
              <Expander open={open === id} onToggle={() => toggle(id)} sub={`${exact(list.length)} apply · ${parts.join(' · ')}${both ? ` · ${both} shared with ${byDevice.size > 2 ? 'other devices' : 'the other device'}` : ''}`}>{name(id)}</Expander>
              {open === id && list.sort((a, b) => (a.rule.effect === b.rule.effect ? 0 : a.rule.effect === 'deny' ? -1 : 1)).map(({ rule, titles }) => (
                <ExactRule key={rule.rule_id} rule={rule} indent open={raw === `${id}:${rule.rule_id}`} onToggle={() => setRaw(raw === `${id}:${rule.rule_id}` ? null : `${id}:${rule.rule_id}`)}
                  title={<>{rule.effect === 'deny' ? 'Never' : 'Allowed'}{limitText(rule)}</>} sub={titles.join(' · ')} />
              ))}
            </div>
          )
        })}
        <Expander open={open === 'all'} onToggle={() => toggle('all')} sub="As the gateway and the CableLabs dashboard show them">{`All ${exact(policy.rules.length)} in PPD terms`}</Expander>
        {open === 'all' && policy.rules.map((r) => (
          <ExactRule key={r.rule_id} rule={r} open={raw === `all:${r.rule_id}`} onToggle={() => setRaw(raw === `all:${r.rule_id}` ? null : `all:${r.rule_id}`)}
            title={<>{r.effect === 'deny' ? 'Never' : 'Allowed'} <span className="sub mono" style={{ fontWeight: 400 }}>{r.rule_id}</span></>} sub={ruleText(r)} />
        ))}
      </Group>
      <Footnote>Every device gets the whole policy and follows the rules that match what it does. Each exact rule covers one exact kind of data flow, so a device can check it directly; we can’t check that devices follow them.</Footnote>
    </>
  )
}

/** One exact rule as a row; tapping it shows the rule as the gateway serves it, in raw JSON. */
function ExactRule({ rule, title, sub, indent, open, onToggle }: { rule: PolicyRule; title: ReactNode; sub: string; indent?: boolean; open: boolean; onToggle: () => void }) {
  const color = rule.effect === 'deny' ? KIND.never.color : limitText(rule) ? KIND.limited.color : KIND.allow.color
  return (
    <>
      <button className="cell xr" aria-expanded={open} onClick={onToggle} style={indent ? { paddingLeft: 32 } : undefined}>
        <div className="cb">
          <span className="ttl" style={{ color, fontWeight: 500, fontSize: indent ? 14 : undefined }}>{title}</span>
          <span className="sub">{sub}</span>
        </div>
        <span className="xr-tag">{open ? 'Hide JSON' : '{ } JSON'}</span>
      </button>
      {open && <pre className="json xr-json">{JSON.stringify(rule, null, 2)}</pre>}
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
