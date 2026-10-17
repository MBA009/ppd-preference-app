import type { DeclarationState, DeviceSummary, Rule } from '../api'

export const STATE_LABEL: Record<DeclarationState, string> = {
  advisory: 'Advisory only · from our library',
  registered_no_declaration: 'Registered · no declaration yet',
  rules_confirmed: 'Gets your rules · Confirmed',
  waiting_for_renewal: 'Gets your rules · Updating',
  stale: 'Gets your rules · Out of date',
  needs_reassociation: 'Needs to reconnect',
}

export function stateLabel(d: DeviceSummary) {
  return STATE_LABEL[d.declaration?.state ?? 'advisory']
}

/** Rules that apply to a device (a rule can be about all devices or a few). */
export function rulesFor(rules: Rule[], deviceId: string) {
  return rules.filter((r) => r.applies_to === 'all' || r.applies_to.includes(deviceId))
}

export function vendorOf(d: DeviceSummary) {
  return d.name.split(' ')[0]
}

/** "Thermostat · Matter · Not in your home yet" style subtitle. */
export function subtitle(d: DeviceSummary, extra?: string) {
  return [d.category_label, d.matter ? 'Matter' : null, extra].filter(Boolean).join(' · ')
}

export function timeAgo(iso: string, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  return `${Math.round(h / 24)} days ago`
}
