import type { RuleEffect, RuleScope } from '../api'

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

export const KEPT_FOREVER = 'retention=ppd:indefinite'

export const EFFECT_LABEL: Record<RuleEffect, string> = { dont_allow: 'Never', ask: 'Ask me first', allow: 'Allowed' }
export const EFFECT_TITLE: Record<RuleEffect, string> = { dont_allow: 'Never allow', ask: 'Ask me first', allow: 'Allow' }

export const isOn = (list: string[] | undefined, c: Choice) => !!list?.length && c.iris.every((i) => list.includes(i))

export function toggle(list: string[] | undefined, c: Choice): string[] | undefined {
  const cur = list ?? []
  const next = isOn(cur, c) ? cur.filter((i) => !c.iris.includes(i)) : [...cur, ...c.iris.filter((i) => !cur.includes(i))]
  return next.length ? next : undefined
}

/** A readable starting title for a rule that has none, built from its scope. */
export function autoTitle(effect: RuleEffect, scope: RuleScope): string {
  const names = (choices: Choice[], list?: string[]) => choices.filter((c) => isOn(list, c)).map((c) => c.label.toLowerCase())
  const parts = [
    names(DATA_CHOICES, scope.data_type).join(', '),
    names(PURPOSE_CHOICES, scope.purpose).join(', ') && 'for ' + names(PURPOSE_CHOICES, scope.purpose).join(' or '),
    names(WHO_CHOICES, scope.handling_context).join(' or ') && '· ' + names(WHO_CHOICES, scope.handling_context).join(' or '),
  ].filter(Boolean)
  const lead = { dont_allow: 'Never', ask: 'Ask me before', allow: 'Allow' }[effect]
  return `${lead}: ${parts.join(' ') || 'any data flow'}`
}
