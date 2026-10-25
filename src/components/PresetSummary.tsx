import { useState } from 'react'
import type { HouseholdPreset } from '../api'
import { Cell, Expander, Group, SectionHeader, Tile } from './ui'
import { ShieldCheck } from './icons'
import { CONDITION_TEXT, kindOf, type RuleKind } from '../policy/choices'
import { plural } from '../lib/verdicts'

export const KIND: Record<RuleKind, { title: string; color: string }> = {
  never: { title: 'Never', color: '#B3261E' },
  limited: { title: 'Allowed only if', color: '#0B57D0' },
  allow: { title: 'Allowed', color: '#1E7D34' },
}

/** A household preset: its name, what sets it apart, and its rules folded behind an expander. */
export function PresetSummary({ preset, open: startOpen = false }: { preset: HouseholdPreset; open?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <Group>
        <Cell className="t" chevron={false} style={{ alignItems: 'flex-start' }}>
          <Tile tone="blue" style={{ marginTop: 10 }}><ShieldCheck /></Tile>
          <div className="cb" style={{ paddingRight: 16 }}>
            <span className="ttl" style={{ fontWeight: 500 }}>{preset.name}</span>
            <span className="sub">{preset.description}</span>
          </div>
        </Cell>
      </Group>
      <SectionHeader>Its rules · {preset.rules.length}</SectionHeader>
      <Group>
        <Expander open={open} onToggle={() => setOpen(!open)}>{open ? 'Hide the rules' : `See ${plural(preset.rules.length, 'rule')}`}</Expander>
        {open && preset.rules.map((r) => {
          const k = KIND[kindOf(r)]
          const label = r.condition ? `${k.title} ${CONDITION_TEXT[r.condition]}` : k.title
          return (
            <Cell key={r.id} chevron={false}>
              <div className="cb" style={{ padding: '10px 0' }}>
                <span className="sub" style={{ color: k.color, fontWeight: 500 }}>{label}</span>
                <span className="ttl" style={{ fontSize: 15, lineHeight: '20px' }}>{r.title.replace(/^[^:]*:\s*/, '')}</span>
              </div>
            </Cell>
          )
        })}
      </Group>
    </>
  )
}
