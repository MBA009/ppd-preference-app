import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { DeviceSummary, Verdict } from '../api'
import { VERDICTS } from '../lib/verdicts'
import { ChevronDown, ChevronRight, ChipGlyph, DeviceGlyph, Icon, RowGlyph } from './icons'

/* ---------- app bars ---------- */
export function AppBar({ title, subtitle, back, right }: { title: string; subtitle?: string; back?: string | true; right?: ReactNode }) {
  const nav = useNavigate()
  return (
    <div className="nav">
      {back && (
        <button className="back" aria-label="Back" onClick={() => (back === true ? nav(-1) : nav(back))}>
          <Icon name="back" />
        </button>
      )}
      {subtitle ? (
        <span className="ntt" style={{ fontSize: 18, lineHeight: '22px', fontWeight: 500 }}>
          <span style={{ display: 'block' }}>{title}</span>
          <span style={{ display: 'block', fontSize: 12, lineHeight: '14px', fontWeight: 400, color: '#5F6368' }}>{subtitle}</span>
        </span>
      ) : (
        <h1 className={'ntt' + (back ? '' : ' lead')} style={{ margin: 0 }}>{title}</h1>
      )}
      {right}
    </div>
  )
}

export function BottomNav() {
  const items = [
    { to: '/', icon: 'home', label: 'My home', end: true },
    { to: '/scan', icon: 'scan', label: 'Scan', end: false },
    { to: '/rules', icon: 'rules', label: 'Rules', end: false },
  ] as const
  return (
    <nav className="tabs" aria-label="Main">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => 'tab' + (isActive ? ' on' : '')}>
          <span className="ti"><Icon name={i.icon} /></span>
          {i.label}
        </NavLink>
      ))}
    </nav>
  )
}

/* ---------- lists ---------- */
export const SectionHeader = ({ children }: { children: ReactNode }) => <div className="sh">{children}</div>
export const Footnote = ({ children }: { children: ReactNode }) => <div className="sf">{children}</div>
export const Group = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => <div className="grp" style={style}>{children}</div>

export function Cell({ to, onClick, className = '', children, chevron = true, ...rest }: {
  to?: string; onClick?: () => void; className?: string; children: ReactNode; chevron?: boolean
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>) {
  const inner = <>{children}{chevron && (to || onClick) && <span className="tr"><ChevronRight /></span>}</>
  if (to) return <Link to={to} className={'cell ' + className} {...rest}>{inner}</Link>
  if (onClick) return <button className={'cell ' + className} onClick={onClick} {...rest}>{inner}</button>
  return <div className={'cell ' + className} {...rest}>{inner}</div>
}

export function Tile({ tone, children, size, style }: { tone: 'blue' | 'green' | 'orange' | 'grey' | 'red'; children: ReactNode; size?: 'device' | 'hero'; style?: React.CSSProperties }) {
  return <span className={`tile ${tone}${size === 'device' ? ' dtile' : ''}${size === 'hero' ? ' hero' : ''}`} style={style}>{children}</span>
}

export function DeviceTile({ device, size = 'device' }: { device: DeviceSummary; size?: 'device' | 'hero' }) {
  return (
    <Tile tone={device.source === 'declared' ? 'blue' : 'grey'} size={size}>
      <DeviceGlyph icon={device.icon} size={size === 'hero' ? 30 : 22} />
    </Tile>
  )
}

/* ---------- verdict marks ---------- */
export function VerdictChip({ verdict, n }: { verdict: Verdict; n: number }) {
  const m = VERDICTS[verdict]
  return <span className={`chip ${m.cls}`}><ChipGlyph verdict={verdict} /><span>{m.chip(n)}</span></span>
}

export function VerdictChips({ counts, order }: { counts: Partial<Record<Verdict, number>>; order: Verdict[] }) {
  return (
    <div className="chips">
      {order.filter((v) => counts[v]).map((v) => <VerdictChip key={v} verdict={v} n={counts[v]!} />)}
    </div>
  )
}

/** Icon-only marker used in list rows; the full label is in the accessible name. */
export function VerdictMark({ verdict }: { verdict: Verdict }) {
  const m = VERDICTS[verdict]
  return <span className={`chip ${m.cls} i`} role="img" aria-label={m.label} title={m.label}><RowGlyph verdict={verdict} /></span>
}

/* ---------- buttons and form controls ---------- */
export function ActionBar({ children }: { children: ReactNode }) { return <div className="act">{children}</div> }

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className="tr" role="switch" aria-checked={on} aria-label={label} style={{ minHeight: 44 }} onClick={() => onChange(!on)}>
      <span className={'sw' + (on ? ' on' : '')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segc" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={'seg' + (o.value === value ? ' on' : '')} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Expander({ open, onToggle, children, sub }: { open: boolean; onToggle: () => void; children: ReactNode; sub?: string }) {
  return (
    <button className="cell" aria-expanded={open} onClick={onToggle}>
      <div className="cb" style={{ padding: '12px 0' }}>
        <span className="ttl" style={{ fontSize: 15, lineHeight: '20px', color: '#0066CC' }}>{children}</span>
        {sub && <span className="sub" style={{ fontSize: 13, lineHeight: '16px' }}>{sub}</span>}
      </div>
      <span className="tr"><ChevronDown up={open} /></span>
    </button>
  )
}

export function Loading({ text = 'Loading…' }: { text?: string }) { return <div className="empty" role="status">{text}</div> }
export function ErrorBox({ error }: { error: Error }) { return <div className="note" role="alert">Something went wrong: {error.message}</div> }
