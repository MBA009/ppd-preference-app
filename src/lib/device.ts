import type { DeclarationState, Device, DeviceSummary } from '../api'

export const STATE_LABEL: Record<DeclarationState, string> = {
  advisory: 'Advisory only · from our library',
  registered_no_declaration: 'Registered, no declaration',
  rules_confirmed: 'Gets your rules · Confirmed',
  waiting_for_renewal: 'Gets your rules · Updating',
  stale: 'Gets your rules · Out of date',
  needs_reassociation: 'Needs to reconnect',
  not_associated: 'Gets your rules · Not confirmed yet',
  broken: 'Gets your rules · Receipt does not match',
}

/** True for devices that talk to the PPD gateway (real or simulated); research entries never do. */
export const isConnected = (d: DeviceSummary) => d.kind === 'real' || d.kind === 'simulated'

/**
 * A library entry with an example declaration (Reolink E1 Zoom, Aqara W200): it stands for a device that supports PPD,
 * written by our team from research. It doesn't connect to the home gateway.
 */
export const isPpdExample = (d: DeviceSummary) => d.kind === 'research' && d.source === 'declared'

/** Supports PPD: connects to the gateway, or stands for a device that does. Only these get the privacy viewer. */
export const supportsPpd = (d: DeviceSummary) => isConnected(d) || isPpdExample(d)

/**
 * A connected device that speaks PPD but sent no declaration (optional in PPD). It gets the household's rules like
 * every device and is assumed to follow them; with nothing it said to compare, it has no per-flow verdicts.
 */
export const declaredNothing = (d: DeviceSummary) => isConnected(d) && !d.declaration

/** A connected device that currently holds the household rules: associated, and not reporting behaviour against them. */
export const hasRules = (d: Device) => d.live?.association.status === 'associated' && !d.live.runtime.conflict_active

/** Why a connected device can't be forgotten yet, or null when it can (it has gone stale and left the network). */
export function forgetBlocker(d: Device): string | null {
  if (!d.live) return 'Only devices that connected through PPD can be forgotten.'
  if (d.live.network.observed) return 'It is still on your home network. Unplug it first.'
  if (d.live.association.status === 'associated') return 'It still has your rules. You can forget it once it goes stale.'
  return null
}

/**
 * The six device states shown to the household (design board "Six device states"). They put the draft's
 * association states (draft-dsmullen-ppd-architecture-11 section 2: current, stale, needs reassociation, broken)
 * into household words, instead of the gateway's own badges.
 */
export type DeviceStateKey = 'advisory' | 'no_declaration' | 'confirmed' | 'waiting' | 'stale' | 'reassociate'

export const DEVICE_STATE: Record<DeviceStateKey, { label: string; meaning: string }> = {
  advisory: { label: 'Advisory only', meaning: 'The device doesn’t register with your home gateway. What you see comes from our library.' },
  no_declaration: { label: 'Registered, no declaration', meaning: 'The device joined and fetched your household policy, but declared nothing.' },
  confirmed: { label: 'Rules confirmed', meaning: 'The device confirmed it received your latest rules and renewed in time. Receipt only: we can’t check that it follows them.' },
  waiting: { label: 'Waiting for renewal', meaning: 'Your rules changed and the device hasn’t fetched them yet.' },
  stale: { label: 'Stale', meaning: 'The device didn’t renew before its freshness limit, so its last confirmation is out of date.' },
  reassociate: { label: 'Needs reassociation', meaning: 'The rules or the device’s own state changed enough that it must start over. It isn’t confirmed until it registers again.' },
}

export function deviceState(d: DeviceSummary | Device): DeviceStateKey {
  if (!isConnected(d)) return 'advisory'
  const live = 'live' in d ? d.live : undefined
  if (!live) return declaredNothing(d) ? 'no_declaration' : d.declaration?.state === 'waiting_for_renewal' ? 'waiting' : 'confirmed'
  const s = live.association.status
  if (s === 'stale_association') return 'stale'
  // The draft has no push: after a rule change the device is out of date until it fetches them (app state).
  if (live.publication === 'waiting' || s === 'not_associated') return 'waiting'
  if (s === 'needs_reassociation' || s === 'broken') return 'reassociate'
  return declaredNothing(d) ? 'no_declaration' : 'confirmed'
}

/** "Connected device" or "Simulated participant" for devices the PPD gateway knows. */
export function kindLabel(d: DeviceSummary) {
  return d.kind === 'simulated' ? 'Simulated participant' : d.kind === 'real' ? 'Connected device' : 'From our library'
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
