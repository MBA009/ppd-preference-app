/**
 * The PPD core taxonomy (draft-dsmullen-ppd-taxonomy-05 section 6) and its plain-language wording.
 *
 * The app and app-api use only these core `ppd:` terms: declarations, household rules and published
 * policies need no extension vocabulary and no prefix declaration, and terms compare by exact identity.
 */

export const TAXONOMY_RELEASE = 'ppd-core-2026-05'

export type Field = 'data_type' | 'purpose' | 'action' | 'source' | 'handling_context'
export const FIELDS: Field[] = ['data_type', 'purpose', 'action', 'source', 'handling_context']

/** Each core term with the wording the app shows for it. */
export const CORE_TERMS: Record<Field, Record<string, string>> = {
  data_type: {
    'ppd:identifierData': 'Names, accounts or device IDs',
    'ppd:profileData': 'Profile and preferences',
    'ppd:sensorData': 'What sensors notice',
    'ppd:contentData': 'Video, photos and sound',
    'ppd:locationData': 'Where you are',
    'ppd:deviceAndNetworkData': 'Device settings and network details',
    'ppd:usageData': 'How you use your devices',
  },
  purpose: {
    'ppd:coreFunctionality': 'Making a feature work',
    'ppd:personalization': 'Personalizing',
    'ppd:communicationsAndNotifications': 'Sending alerts',
    'ppd:security': 'Security',
    'ppd:diagnosticsAndMaintenance': 'Fixing problems',
    'ppd:analyticsAndImprovement': 'Improving products',
    'ppd:legalCompliance': 'Legal obligations',
    'ppd:advertisingAndMarketing': 'Advertising',
  },
  action: {
    'ppd:collection': 'Collected',
    'ppd:use': 'Used',
    'ppd:transfer': 'Sent to another party',
    'ppd:inference': 'Worked out from other data',
  },
  source: {
    'ppd:userProvided': 'You',
    'ppd:participantObserved': 'The device notices it',
    'ppd:participantGenerated': 'The device',
    'ppd:householdProvided': 'Another device in your home',
    'ppd:vendorProvided': 'The maker',
    'ppd:thirdPartyProvided': 'Another company',
    'ppd:derivedFromPriorData': 'Worked out from earlier data',
  },
  handling_context: {
    'ppd:householdContext': 'Your household',
    'ppd:vendorContext': 'The maker or its services',
    'ppd:thirdPartyContext': 'Other companies',
    'ppd:publicAudience': 'Anyone (public)',
  },
}

export const RETENTION: Record<string, string> = { 'ppd:ephemeral': 'Not kept', 'ppd:indefinite': 'Until deleted' }
export const PROCESSING_BOUNDARY: Record<string, string> = {
  'ppd:onDeviceOnly': 'Stays on the device',
  'ppd:inHomeOnly': 'Stays in your home',
  'ppd:approvedRemoteProcessing': 'Approved remote processing',
}
export const JURISDICTION_SCOPES = ['collection', 'use', 'inference', 'transfer', 'storage'] as const

/** The Constraints Object (draft-dsmullen-ppd-protocol-04 section 7.12). */
export interface Constraints {
  retention?: string
  processing_boundary?: string
  jurisdiction?: { scope: (typeof JURISDICTION_SCOPES)[number]; countrycode?: string[]; subdivisioncode?: string[] }
}

export const isCoreTerm = (field: Field, term: string) => term in CORE_TERMS[field]
export const termLabel = (field: Field, term: string) => CORE_TERMS[field][term] ?? term

/**
 * Constraints as the `key=value` strings household rules are written in (for example
 * `retention=ppd:indefinite`). A jurisdiction becomes `jurisdiction.<scope>=<code>` per code.
 */
export function constraintKeys(c: Constraints | undefined): string[] {
  if (!c) return []
  const out: string[] = []
  if (c.retention) out.push(`retention=${c.retention}`)
  if (c.processing_boundary) out.push(`processing_boundary=${c.processing_boundary}`)
  if (c.jurisdiction) for (const code of [...(c.jurisdiction.countrycode ?? []), ...(c.jurisdiction.subdivisioncode ?? [])]) out.push(`jurisdiction.${c.jurisdiction.scope}=${code}`)
  return out
}

/** A problem with a statement or rule, in the words app-api reports to the person. */
export interface TermProblem { where: string; message: string }

/** Checks one five-field dataflow and its constraints the way the gateway does (protocol-04 section 7.3). */
export function checkDataflow(where: string, flow: Record<Field, string> & { constraints?: Constraints }): TermProblem[] {
  const problems: TermProblem[] = []
  for (const f of FIELDS) {
    const v = flow[f]
    if (!v) problems.push({ where, message: `${f} is missing` })
    else if (!isCoreTerm(f, v)) problems.push({ where, message: `${v} is not a core ${f} term` })
  }
  const c = flow.constraints ?? {}
  if (c.retention && !(c.retention in RETENTION)) problems.push({ where, message: `${c.retention} is not a core retention value` })
  if (c.processing_boundary) {
    if (!(c.processing_boundary in PROCESSING_BOUNDARY)) problems.push({ where, message: `${c.processing_boundary} is not a core processing_boundary value` })
    if (flow.action !== 'ppd:use' && flow.action !== 'ppd:inference') problems.push({ where, message: 'processing_boundary only applies to use or inference' })
  }
  if (c.jurisdiction) {
    const j = c.jurisdiction
    const codes = [...(j.countrycode ?? []), ...(j.subdivisioncode ?? [])]
    if (!JURISDICTION_SCOPES.includes(j.scope) || !codes.length) problems.push({ where, message: 'jurisdiction needs a scope and at least one code' })
  }
  return problems
}

/** "What sensors notice · Making a feature work · Sent to another party" style summary of a dataflow. */
export function describeDataflow(flow: Record<Field, string>): string {
  return [termLabel('data_type', flow.data_type), termLabel('purpose', flow.purpose), termLabel('action', flow.action)].join(' · ')
}
