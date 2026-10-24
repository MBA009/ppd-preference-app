import type { Rule, RuleCondition, RuleEffect, RuleScope } from '../api'

/** Plain-language choices the rule editor offers. Each maps to one or more taxonomy terms. */
export interface Choice { id: string; label: string; iris: string[] }

export const DATA_CHOICES: Choice[] = [
  { id: 'content', label: 'Video, photos and sound', iris: ['ppd:contentData'] },
  { id: 'location', label: 'Where you are', iris: ['ppd:locationData'] },
  { id: 'sensor', label: 'What sensors notice', iris: ['ppd:sensorData'] },
  { id: 'identity', label: 'Who you are', iris: ['ppd:identifierData', 'ppd:profileData'] },
  { id: 'usage', label: 'How you use your devices', iris: ['ppd:usageData'] },
  { id: 'network', label: 'Device and network details', iris: ['ppd:deviceAndNetworkData'] },
]

export const PURPOSE_CHOICES: Choice[] = [
  { id: 'core', label: 'Making a feature work', iris: ['ppd:coreFunctionality'] },
  { id: 'comms', label: 'Sending alerts', iris: ['ppd:communicationsAndNotifications'] },
  { id: 'diag', label: 'Fixing problems', iris: ['ppd:diagnosticsAndMaintenance'] },
  { id: 'analytics', label: 'Improving products', iris: ['ppd:analyticsAndImprovement'] },
  { id: 'personal', label: 'Personalizing', iris: ['ppd:personalization'] },
  { id: 'ads', label: 'Advertising', iris: ['ppd:advertisingAndMarketing'] },
  { id: 'security', label: 'Security', iris: ['ppd:security'] },
]

export const WHO_CHOICES: Choice[] = [
  { id: 'vendor', label: 'The maker or its services', iris: ['ppd:vendorContext'] },
  { id: 'third', label: 'Other companies', iris: ['ppd:thirdPartyContext'] },
  { id: 'home', label: 'Stays in my home', iris: ['ppd:householdContext'] },
]

export const ACTION_CHOICES: Choice[] = [
  { id: 'collection', label: 'Collected', iris: ['ppd:collection'] },
  { id: 'transfer', label: 'Sent out', iris: ['ppd:transfer'] },
  { id: 'use', label: 'Used', iris: ['ppd:use'] },
  { id: 'inference', label: 'Worked out', iris: ['ppd:inference'] },
]

export const SOURCE_CHOICES: Choice[] = [
  { id: 'you', label: 'You enter or choose it', iris: ['ppd:userProvided'] },
  { id: 'device', label: 'The device notices or produces it', iris: ['ppd:participantObserved', 'ppd:participantGenerated'] },
  { id: 'derived', label: 'Worked out from other data', iris: ['ppd:derivedFromPriorData'] },
  { id: 'others', label: 'Other devices or companies', iris: ['ppd:householdProvided', 'ppd:vendorProvided', 'ppd:thirdPartyProvided'] },
]

export const KEPT_FOREVER = 'retention=ppd:indefinite'

export const EFFECT_LABEL: Record<RuleEffect, string> = { dont_allow: 'Never', allow: 'Allowed' }

/** The conditions an allow rule can carry, in the words after "Allowed only if". */
export const CONDITION_TEXT: Record<RuleCondition, string> = {
  'processing_boundary=ppd:inHomeOnly': 'it is processed in my home',
  'processing_boundary=ppd:onDeviceOnly': 'it stays on the device',
  'retention=ppd:ephemeral': 'it is not kept',
}
export const CONDITIONS = Object.keys(CONDITION_TEXT) as RuleCondition[]
export const isBoundary = (c: RuleCondition | null | undefined) => !!c?.startsWith('processing_boundary=')

/** How a rule reads on the rules page: never, allowed only if, or allowed. */
export type RuleKind = 'never' | 'limited' | 'allow'
export const kindOf = (r: Rule): RuleKind => (r.effect === 'dont_allow' ? 'never' : r.condition ? 'limited' : 'allow')

export const isOn = (list: string[] | undefined, c: Choice) => !!list?.length && c.iris.every((i) => list.includes(i))

export function toggle(list: string[] | undefined, c: Choice): string[] | undefined {
  const cur = list ?? []
  const next = isOn(cur, c) ? cur.filter((i) => !c.iris.includes(i)) : [...cur, ...c.iris.filter((i) => !cur.includes(i))]
  return next.length ? next : undefined
}

/** A readable starting title for a rule that has none, built from its scope. */
export function autoTitle(effect: RuleEffect, scope: RuleScope, condition?: RuleCondition | null): string {
  const names = (choices: Choice[], list?: string[]) => choices.filter((c) => isOn(list, c)).map((c) => c.label.toLowerCase())
  const parts = [
    names(DATA_CHOICES, scope.data_type).join(', '),
    names(PURPOSE_CHOICES, scope.purpose).join(', ') && 'for ' + names(PURPOSE_CHOICES, scope.purpose).join(' or '),
    names(WHO_CHOICES, scope.handling_context).join(' or ') && '· ' + names(WHO_CHOICES, scope.handling_context).join(' or '),
  ].filter(Boolean)
  const lead = effect === 'dont_allow' ? 'Never' : condition ? `Allow only if ${CONDITION_TEXT[condition]}` : 'Allow'
  return `${lead}: ${parts.join(' ') || 'any data flow'}`
}
