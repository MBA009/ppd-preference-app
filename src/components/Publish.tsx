import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Policy, type PolicyRule } from '../api'
import { useHousehold, useMe, useOverview, usePresets, usePreview, usePublished } from '../state/data'
import { PROCESSING_BOUNDARY, RETENTION, termLabel } from '../../shared/taxonomy'
import { Cell, Expander, Footnote, Group, SectionHeader, Tile } from './ui'
import { Icon, ShieldCheck } from './icons'
import { plural } from '../lib/verdicts'

/**
 * Sending the household rules to the devices. The app compiles the rules into one
 * PPD household policy of atomic allow/deny rules, one per dataflow a connected device declared, and the
 * gateway serves it. Devices then fetch and confirm it.
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
  const { toast } = useHousehold()
  const { data: me } = useMe()
  const preview = usePreview()
  const published = usePublished()
  const overview = useOverview()
  const [busy, setBusy] = useState(false)
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

  const changes = p.rules.filter((r) => r.change !== 'unchanged').length + p.removed.length
  const fromApp = overview.data?.household_policy.published_by_app
  const operator = me?.role === 'operator'

  const send = async () => {
    setBusy(true)
    try {
      const result = await api.publish()
      toast(`Sent ${plural(result.rules, 'rule')} to your devices.`)
      preview.reload()
      published.reload()
      overview.reload()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const title = !p.devices
    ? 'No connected devices yet'
    : changes || !fromApp
      ? 'Send your rules to your devices'
      : 'Your devices have your latest rules'
  const sub = !p.devices
    ? 'When a device that supports PPD joins your home, your rules can be sent to it.'
    : changes
      ? `${plural(changes, 'change')} since the rules your devices have now.`
      : fromApp
        ? `${plural(p.rules.length, 'rule')} for ${plural(p.devices, 'device')}.`
        : 'The rules your devices have now were not sent from this app.'

  return (
    <>
      <Group style={{ marginBottom: 4 }}>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone={changes || !fromApp ? 'blue' : 'green'} style={{ marginTop: 10 }}>{changes || !fromApp ? <Icon name="publish" size={18} /> : <ShieldCheck />}</Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{title}</span>
            <span className="sub">{sub}</span>
          </div>
        </Cell>
        {p.devices > 0 && (changes > 0 || !fromApp) && operator && (
          <div className="cell" style={{ padding: '6px 16px 12px' }}>
            <button className="btn" style={{ flex: 'none', minWidth: 200 }} disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send to my devices'}</button>
          </div>
        )}
      </Group>
      {p.warnings.map((w) => <Footnote key={w}>{w}</Footnote>)}
      {!operator && me && <Footnote>Only the household operator can send rules.</Footnote>}
    </>
  )
}

/** The rules the gateway serves right now, in plain language. */
export function PublishedRules() {
  const { data: policy } = usePublished()
  const [open, setOpen] = useState(false)
  if (!policy) return null
  const allow = policy.rules.filter((r) => r.effect === 'allow')
  const deny = policy.rules.filter((r) => r.effect === 'deny')
  return (
    <>
      <SectionHeader>What your devices receive</SectionHeader>
      <Group>
        <div className="cell kv"><span className="ttl">Rules in force</span><span className="v mono">{policy.policy_id}</span></div>
        <Expander open={open} onToggle={() => setOpen(!open)} sub={`${plural(deny.length, 'deny rule')} · ${plural(allow.length, 'allow rule')}`}>{open ? 'Hide the rules' : 'Show the rules'}</Expander>
        {open && policy.rules.map((r) => (
          <div key={r.rule_id} className="cell">
            <div className="cb"><span className="ttl" style={{ color: r.effect === 'deny' ? '#B3261E' : '#1E7D34', fontWeight: 500 }}>{r.effect === 'deny' ? 'Never' : 'Allowed'}</span><span className="sub">{ruleText(r)}</span></div>
          </div>
        ))}
      </Group>
      <Footnote>Each rule covers one exact kind of data flow, so a device can check it directly. Devices only receive rules; we can’t check that they follow them.</Footnote>
    </>
  )
}

/** CableLabs' example household policies, for resetting the demo. */
export function Presets() {
  const { toast } = useHousehold()
  const { data: me } = useMe()
  const { data: presets, reload } = usePresets()
  const published = usePublished()
  if (me?.role !== 'operator' || !presets?.length) return null
  const apply = async (name: string, title: string) => {
    if (!window.confirm(`Replace the rules your devices receive with “${title}”? Your household rules in this app stay as they are.`)) return
    try {
      const p: Policy = await api.applyPreset(name)
      toast(`Devices will receive ${p.policy_id}.`)
      reload()
      published.reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }
  return (
    <>
      <SectionHeader>Gateway example policies</SectionHeader>
      <Group>
        {presets.map((p) => (
          <Cell key={p.name} className="t" chevron={false} onClick={p.current ? undefined : () => apply(p.name, p.title)}>
            <div className="cb"><span className="ttl" style={p.current ? undefined : { color: '#0066CC' }}>{p.title}</span><span className="sub">{p.current ? 'Being served now' : p.summary}</span></div>
          </Cell>
        ))}
      </Group>
      <Footnote>For testing: these send one of the gateway’s fixed example policies straight to the devices. They are not your household preset. Send your rules again to go back to your own. <Link className="link" to="/status">System status</Link></Footnote>
    </>
  )
}
