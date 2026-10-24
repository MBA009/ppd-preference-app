import type { ReactNode } from 'react'
import type { DeviceIcon, Verdict } from '../api'

type P = { size?: number; className?: string }

const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** 24-grid outline icons. */
const PATHS: Record<string, { w: number; node: ReactNode }> = {
  back: { w: 2, node: <path d="M19 12H5M11 6l-6 6 6 6" /> },
  plus: { w: 2.4, node: <path d="M12 5v14M5 12h14" /> },
  search: { w: 2.2, node: (<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>) },
  home: { w: 2, node: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /> },
  scan: { w: 2, node: (<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></>) },
  rules: { w: 2, node: <path d="M5 6h14M5 12h14M5 18h9" /> },
  check: { w: 2.8, node: <path d="M5 12.5l4.5 4.5L19 7" /> },
  thermostat: { w: 2, node: (<><circle cx="12" cy="12" r="8" /><path d="M12 12l3-3" /></>) },
  lock: { w: 2, node: (<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>) },
  tv: { w: 2, node: (<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M9 20h6M12 17v3" /></>) },
  camera: { w: 2, node: (<><rect x="3" y="8" width="18" height="11" rx="2" /><circle cx="12" cy="13.5" r="3" /><path d="M8 8l1.5-2.5h5L16 8" /></>) },
  bulb: { w: 2, node: (<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></>) },
  status: { w: 2, node: <path d="M3 12h4l3-7 4 14 3-7h4" /> },
  publish: { w: 2, node: (<><path d="M12 15V4M7 9l5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>) },
}

export function Icon({ name, size = 24, className }: P & { name: keyof typeof PATHS }) {
  const p = PATHS[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={p.w} className={className} aria-hidden="true" {...stroke}>
      {p.node}
    </svg>
  )
}

export function DeviceGlyph({ icon, size = 22 }: P & { icon: DeviceIcon }) {
  return <Icon name={icon} size={size} />
}

export function ChevronRight({ size = 18 }: P) {
  return (
    <svg className="chev" width={size} height={size} viewBox="0 0 24 24" strokeWidth={2.2} aria-hidden="true" {...stroke}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}
export function ChevronDown({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" strokeWidth={2} stroke="#5F6368" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={up ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M1.5 1.5L7 6.5l5.5-5" />
    </svg>
  )
}

export function ShieldCheck({ size = 17 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth={1.6} aria-hidden="true" {...stroke}>
      <path d="M7 1.5l4.5 1.7v3.4c0 2.8-1.9 4.6-4.5 5.9C4.4 11.2 2.5 9.4 2.5 6.6V3.2z" />
      <path d="M5 6.8l1.4 1.4L9 5.4" />
    </svg>
  )
}
export function DocIcon({ size = 17 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth={1.6} aria-hidden="true" {...stroke}>
      <path d="M3.5 1.5h5l2.5 2.5v8.5h-7.5z" />
      <path d="M5.5 7h3.5M5.5 9.5h3.5" />
    </svg>
  )
}
export function InfoCircle({ size = 17 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth={1.8} aria-hidden="true" {...stroke}>
      <circle cx="7" cy="7" r="5.5" />
      <path d="M7 4v3.3" />
      <circle cx="7" cy="10" r=".7" fill="currentColor" />
    </svg>
  )
}
export function DashedCircle({ size = 14 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth={1.8} stroke="#5F6368" fill="none" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" strokeDasharray="2 2" />
    </svg>
  )
}
export function SmallCheck({ size = 14, color = '#1E7D34' }: P & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" strokeWidth={2.2} stroke={color} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5l3 3 6-7" />
    </svg>
  )
}

/** Small glyph used inside a coloured chip (white on colour), 14-grid outline. */
export function ChipGlyph({ verdict, size = 12 }: { verdict: Verdict; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true } as const
  switch (verdict) {
    case 'unsatisfiable':
      return (<svg {...common} strokeWidth={1.8} {...stroke}><path d="M7 1.8l5.4 9.4H1.6z" /><path d="M7 5.6v2.6" /><circle cx="7" cy="10" r=".6" fill="currentColor" /></svg>)
    case 'indeterminate':
      return (<svg {...common} strokeWidth={1.8} {...stroke}><circle cx="7" cy="7" r="5.5" /><path d="M5.4 5.6a1.7 1.7 0 1 1 2.5 1.5c-.6.4-.9.8-.9 1.4" /><circle cx="7" cy="10.4" r=".7" fill="currentColor" /></svg>)
    case 'conditionally_satisfiable':
      return (<svg {...common} strokeWidth={1.8} {...stroke}><path d="M2 4h10M2 10h10" /><circle cx="5" cy="4" r="1.6" fill="currentColor" /><circle cx="9" cy="10" r="1.6" fill="currentColor" /></svg>)
    case 'compatible':
      return (<svg {...common} strokeWidth={2.2} {...stroke}><path d="M2.5 7.5l3 3 6-7" /></svg>)
  }
}

/** Icon-only marker for list rows: filled glyph, no chip background. */
export function RowGlyph({ verdict }: { verdict: Verdict }) {
  const w = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true } as const
  switch (verdict) {
    case 'unsatisfiable':
      return (<svg {...w}><path d="M8 1.9L14.6 13.3H1.4Z" fill="currentColor" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" /><path d="M8 6.2v3.3" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" /><circle cx="8" cy="11.5" r=".95" fill="#fff" /></svg>)
    case 'indeterminate':
      return (<svg {...w}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M6.2 6.3a1.9 1.9 0 1 1 2.9 1.6c-.7.45-1.1.9-1.1 1.7" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" /><circle cx="8" cy="11.8" r=".95" fill="#fff" /></svg>)
    case 'conditionally_satisfiable':
      return (<svg {...w}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M4.5 6h7M4.5 10h7" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" /><circle cx="6.3" cy="6" r="1.4" fill="#fff" /><circle cx="9.7" cy="10" r="1.4" fill="#fff" /></svg>)
    case 'compatible':
      return (<svg {...w}><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M4.6 8.3l2.3 2.3 4.6-5" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>)
  }
}
