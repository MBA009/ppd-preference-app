import type { Device, DeviceIcon, Flow, Rule } from '../api'
import type { Constraints } from '../../shared/taxonomy'
import { termLabel } from '../../shared/taxonomy'
import { evaluateDevice } from '../../shared/engine'

/**
 * A privacy code that carries the declaration itself: the device's data flows as JSON, so scanning works without
 * looking anything up. Written by tools/make_qr_codes.mjs.
 *
 *   QR text:  "ppd1:" + base64url( zlib deflate( JSON ) )
 *   JSON:     { "ppd": 1, "device": "level-lock", "id": "level-lock-01", "name": "Level Lock", "cat": "smart_lock",
 *               "cat_label": "Smart door lock", "icon": "lock", "matter": true,
 *               "flows": [[data_type, purpose, action, source, handling_context, handled_by, title, constraints?], ...] }
 *
 * The five terms are PPD core taxonomy IRIs (ppd:contentData, ...). The full JSON is 25 to 32 KB per device, far over
 * what a QR code holds; this is about 1.2 KB.
 */
export const CODE_PREFIX = 'ppd1:'

type CodeFlow = [string, string, string, string, string, string, string, Constraints?]
export interface DeclarationCode {
  ppd: 1
  device: string
  id: string
  name: string
  cat: string
  cat_label: string
  icon: DeviceIcon
  matter?: boolean
  flows: CodeFlow[]
}

export const isDeclarationCode = (text: string) => text.trim().toLowerCase().startsWith(CODE_PREFIX)

/** Reads a scanned code. Throws when it is not a readable declaration. */
export async function decodeDeclaration(text: string): Promise<DeclarationCode> {
  const b64 = text.trim().slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const data = JSON.parse(await new Response(stream).text()) as DeclarationCode
  if (data?.ppd !== 1 || typeof data.device !== 'string' || !Array.isArray(data.flows)) throw new Error('Not a PPD declaration')
  return data
}

const ACTION_WHO: Record<string, string> = {
  'ppd:collection': 'Collected by', 'ppd:use': 'Used by', 'ppd:transfer': 'Goes to', 'ppd:inference': 'Worked out by',
}
/** "A third-party service" reads "Goes to a third-party service"; names (Reolink, LG) keep their capitals. */
const lowerFirst = (s: string) => s.replace(/^(A|An|Your) /, (w) => w.toLowerCase())

/** The device the code describes, checked against the household's rules. */
export function deviceFromCode(code: DeclarationCode, rules: Rule[]): Device {
  const flows: Flow[] = code.flows.map(([data_type, purpose, action, source, handling_context, who, title, constraints], i) => {
    const home = handling_context === 'ppd:householdContext'
    const whoText = home ? 'Stays in your home' : `${ACTION_WHO[action] ?? 'Handled by'} ${lowerFirst(who)}`
    const purposeText = termLabel('purpose', purpose).toLowerCase()
    const retention = constraints?.retention
    return {
      id: `${code.device}.code-${i}`,
      title,
      workbook_text: title,
      summary: `${whoText} · ${purposeText}`,
      summary_parts: { who: whoText, purpose: purposeText },
      phase: 'runtime',
      taxonomy: { data_type, purpose, action, source, handling_context, constraints: constraints ?? {} },
      core: { data_type, purpose, action, source, handling_context },
      display: {
        what: termLabel('data_type', data_type),
        why: termLabel('purpose', purpose),
        what_happens: termLabel('action', action),
        comes_from: termLabel('source', source),
        handled_by: who,
        kept: retention === 'ppd:ephemeral' ? 'Not kept' : retention === 'ppd:indefinite' ? 'Until deleted' : 'Not stated',
        limit: null,
      },
      core_group: { id: `${code.device}.code-${i}`, label: title },
      control: { type: 'unknown', type_label: 'Not in the code', necessity: 'unknown', note: null },
      evidence: 'source_linked',
      evaluation: { verdict: 'indeterminate', rule_id: null, reason: '' },
    }
  })
  return evaluateDevice({
    id: code.device,
    name: code.name,
    short_name: code.name,
    category: code.cat,
    category_label: code.cat_label,
    icon: code.icon,
    matter: !!code.matter,
    source: 'declared',
    kind: 'research',
    declaration: null,
    declaration_id_example: code.id,
    flow_count: flows.length,
    flows,
  }, rules)
}

/* The last scanned declaration, kept for this tab so the viewer survives a reload. */
const KEY = 'ppd.scanned-declaration.v1'
export function saveScanned(code: DeclarationCode) {
  try { sessionStorage.setItem(KEY, JSON.stringify(code)) } catch { /* private mode: the viewer still has it in memory */ }
  memory = code
}
let memory: DeclarationCode | null = null
export function loadScanned(): DeclarationCode | null {
  if (memory) return memory
  try { const raw = sessionStorage.getItem(KEY); return raw ? (memory = JSON.parse(raw)) : null } catch { return null }
}
