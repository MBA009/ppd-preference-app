import type { Rule } from './types'
import { CORE_TERMS, type Field } from './taxonomy'
import { conditionShort } from './conditions'

/**
 * Rule names, generated from the rule itself: what happens, then its scope. Nobody types a name, so a name always says
 * what the rule covers. The same words as the exported presets (ppd-household-presets notebook 07): every preset
 * rule's own title comes out of ruleTitle unchanged.
 */

const PLAIN: Record<string, string> = {
  'ppd:identifierData': 'account and identity details', 'ppd:profileData': 'habits and preferences',
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
  const lead = rule.effect === 'dont_allow' ? 'Never' : rule.condition ? `Allow only if ${conditionShort(rule.condition)}` : 'Allow'
  const parts = ORDER.map((f) => termsText(f, rule.scope[f]?.length ? rule.scope[f]! : Object.keys(CORE_TERMS[f]))).filter(Boolean)
  if (rule.scope.constraints?.includes('retention=ppd:indefinite')) parts.push('if the device keeps it forever')
  return `${lead}: ${parts.length ? parts.join(' · ') : 'everything else'}`
}

/** Where data goes, as a phrase that follows the data ("any data that stays in your home"). */
const WHERE: Record<string, string> = {
  'ppd:householdContext': 'kept in your home', 'ppd:vendorContext': 'sent to the device maker',
  'ppd:thirdPartyContext': 'shared with other companies', 'ppd:publicAudience': 'made public',
}
/** What happens to the data, as things a device does with it. */
const DOING: Record<string, string> = {
  'ppd:collection': 'collecting the data in the first place', 'ppd:use': 'the company using data it already has, without passing it on',
  'ppd:transfer': 'passing the data on to someone else', 'ppd:inference': 'working out new information from the data',
}

/** "a, b or c" (or "a, b and c" for what's left out). */
const list = (items: string[], last: 'or' | 'and') => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1)}`
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * A rule in sentences, for reading rather than for its name: what data and where it goes, then why, then anything
 * narrower. "Allow: staying in your home · for anything except advertising" reads as "Any data that stays in your
 * home" / "For any reason except advertising". The rule's name (ruleTitle) is unchanged.
 */
export function ruleSentence(rule: Pick<Rule, 'effect' | 'condition' | 'scope'>): { head: string; why: string; more: string[]; sentence: string } {
  const all = (f: Field) => Object.keys(CORE_TERMS[f])
  const pick = (f: Field) => (rule.scope[f]?.length ? rule.scope[f]! : all(f))
  const split = (f: Field) => { const terms = pick(f); return { terms, missing: all(f).filter((t) => !terms.includes(t)), every: terms.length === all(f).length } }

  const more: string[] = []
  const data = split('data_type')
  // Leaving out one kind reads fine in the heading; leaving out several gets a line of its own.
  const most = !data.every && data.missing.length < data.terms.length
  const what = data.every ? 'any data' : most ? (data.missing.length === 1 ? `any data except ${plain(data.missing)[0]}` : 'most kinds of data') : list(plain(data.terms), 'or')
  if (most && data.missing.length > 1) more.push(`Not ${list(plain(data.missing), 'or')}`)
  const where = split('handling_context')
  const place = where.every ? ''
    : where.missing.length === 1 && where.missing[0] === 'ppd:householdContext' ? 'sent outside your home'
      : list(where.terms.map((t) => WHERE[t]), 'or')
  const head = upper([what, place].filter(Boolean).join(' '))

  const purpose = split('purpose')
  const why = purpose.every ? 'For any reason' : purpose.missing.length < purpose.terms.length ? `For any reason except ${list(plain(purpose.missing), 'or')}` : `For ${list(plain(purpose.terms), 'or')}`

  const action = split('action')
  // Every flow is decided by exactly one rule, so what this rule leaves out, another rule decides: say so.
  if (!action.every) more.push(action.missing.length < action.terms.length
    ? `Doesn’t cover ${list(action.missing.map((t) => DOING[t]), 'or')}. Another rule decides that`
    : `Only covers ${list(action.terms.map((t) => DOING[t]), 'or')}. Other rules decide the rest`)
  const source = split('source')
  if (!source.every) more.push(source.missing.length < source.terms.length ? `Doesn’t cover data ${list(plain(source.missing), 'or')}` : `Only covers data ${list(plain(source.terms), 'or')}`)
  if (rule.scope.constraints?.includes('retention=ppd:indefinite')) more.push('Only if the device keeps it forever')

  const lead = rule.effect === 'dont_allow' ? 'Never allow' : rule.condition ? `Allow only if ${conditionShort(rule.condition)}:` : 'Allow'
  const sentence = `${lead} ${head.charAt(0).toLowerCase() + head.slice(1)}, ${why.charAt(0).toLowerCase() + why.slice(1)}${more.length ? `. ${more.join('. ')}` : ''}.`
  return { head, why, more, sentence }
}

/** A rule's name is always generated from what it does; any stored title is replaced. */
export const named = (rule: Rule): Rule => ({ ...rule, title: ruleTitle(rule) })
