import type { Rule } from './types'
import { CORE_TERMS, type Field } from './taxonomy'

/**
 * Rule names, generated from the rule itself: what happens, then its scope. Nobody types a name, so a name always says
 * what the rule covers. The same words as the exported presets (ppd-household-presets notebook 07): every preset
 * rule's own title comes out of ruleTitle unchanged.
 */

const PLAIN: Record<string, string> = {
  'ppd:identifierData': 'account and identity details', 'ppd:profileData': 'profile and preferences',
  'ppd:sensorData': 'sensor readings', 'ppd:contentData': 'video, photos and sound', 'ppd:locationData': 'location',
  'ppd:deviceAndNetworkData': 'device and network details', 'ppd:usageData': 'how you use your devices',
  'ppd:coreFunctionality': 'making features work', 'ppd:personalization': 'personalizing what you see',
  'ppd:communicationsAndNotifications': 'alerts and messages', 'ppd:security': 'security',
  'ppd:diagnosticsAndMaintenance': 'fixing problems', 'ppd:analyticsAndImprovement': 'improving products',
  'ppd:legalCompliance': 'legal obligations', 'ppd:advertisingAndMarketing': 'advertising',
  'ppd:collection': 'collected', 'ppd:use': 'used', 'ppd:transfer': 'sent on', 'ppd:inference': 'used to work out new information',
  'ppd:userProvided': 'you entered', 'ppd:participantObserved': 'the device observes', 'ppd:participantGenerated': 'the device generates',
  'ppd:householdProvided': 'other devices in your home provide', 'ppd:vendorProvided': 'the maker provides',
  'ppd:thirdPartyProvided': 'other companies provide', 'ppd:derivedFromPriorData': 'worked out from earlier data',
  'ppd:householdContext': 'staying in your home', 'ppd:vendorContext': 'going to the device maker',
  'ppd:thirdPartyContext': 'going to other companies', 'ppd:publicAudience': 'made public',
}
const EFFECT_TEXT = { never: 'Never', allow: 'Allow', 'retention=ppd:ephemeral': 'Allow only if not kept',
  'processing_boundary=ppd:inHomeOnly': 'Allow only if processed in your home', 'processing_boundary=ppd:onDeviceOnly': 'Allow only if processed on the device' } as const
const ORDER: Field[] = ['data_type', 'handling_context', 'purpose', 'action', 'source']
const WORDS: Record<Exclude<Field, 'handling_context'>, [string, string]> = {
  data_type: ['', 'any data except '], purpose: ['for ', 'for anything except '], action: ['when ', 'except when '], source: ['that ', 'unless '],
}

/** Plain words for terms, in the order of their ppd: ids (as notebook 07 lists them). */
const plain = (terms: string[]) => [...terms].sort().map((t) => PLAIN[t])

function termsText(field: Field, terms: string[]): string | null {
  const everything = Object.keys(CORE_TERMS[field])
  if (terms.length === everything.length) return null
  const missing = everything.filter((t) => !terms.includes(t))
  if (field === 'handling_context') {
    if (terms.length === everything.length - 1 && !terms.includes('ppd:householdContext')) return 'leaving your home'
    return plain(terms).join(' or ')
  }
  const [some, except] = WORDS[field]
  if (missing.length < terms.length) return field === 'action' ? 'except when ' + plain(missing).join(' or ') : except + plain(missing).join(', ')
  return some + plain(terms).join(field === 'action' || field === 'source' ? ' or ' : ', ')
}

export function ruleTitle(rule: Pick<Rule, 'effect' | 'condition' | 'scope'>): string {
  const lead = rule.effect === 'dont_allow' ? EFFECT_TEXT.never : rule.condition ? EFFECT_TEXT[rule.condition] : EFFECT_TEXT.allow
  const parts = ORDER.map((f) => termsText(f, rule.scope[f]?.length ? rule.scope[f]! : Object.keys(CORE_TERMS[f]))).filter(Boolean)
  if (rule.scope.constraints?.includes('retention=ppd:indefinite')) parts.push('if the device keeps it forever')
  return `${lead}: ${parts.length ? parts.join(' · ') : 'everything else'}`
}

/** A rule's name is always generated from what it does; any stored title is replaced. */
export const named = (rule: Rule): Rule => ({ ...rule, title: ruleTitle(rule) })
