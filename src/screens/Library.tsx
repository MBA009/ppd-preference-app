import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { DeviceSummary } from '../api'
import { AppBar, DeviceTile, ErrorBox, Footnote, Loading, SectionHeader } from '../components/ui'
import { Icon, SmallCheck } from '../components/icons'
import { useHousehold, useLibrary } from '../state/data'
import { supportsPpd } from '../lib/device'

/** Screen 3b: researched (advisory) devices, plus any device that has published a declaration. */
export default function Library() {
  const nav = useNavigate()
  const lib = useLibrary()
  const { household, addDevice } = useHousehold()
  const [q, setQ] = useState('')

  if (lib.error) return <><AppBar title="Device library" back="/" /><ErrorBox error={lib.error} /></>
  if (!lib.data || !household) return <><AppBar title="Device library" back="/" /><Loading /></>

  const term = q.trim().toLowerCase()
  const matching = lib.data.filter((d) => !term || `${d.name} ${d.short_name} ${d.category_label}`.toLowerCase().includes(term))
  const connected = matching.filter((d) => d.kind === 'real' || d.kind === 'simulated')
  const shown = matching.filter((d) => d.kind !== 'real' && d.kind !== 'simulated')
  const inHome = (d: DeviceSummary) => household.devices.some((h) => h.device_id === d.id)
  // The library is for checking devices against your household policy: devices that support PPD open in the privacy
  // viewer; the others have no declaration to draw, so they open the device check.
  const open = (d: DeviceSummary) => (supportsPpd(d) ? `/viewer/${encodeURIComponent(d.id)}` : `/preview/${encodeURIComponent(d.id)}`)

  const ppd = shown.filter(supportsPpd)
  const other = shown.filter((d) => !supportsPpd(d))

  const row = (d: DeviceSummary) => (
    <div key={d.id} className="cell d">
      <Link to={open(d)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, color: 'inherit' }}>
        <DeviceTile device={d} />
        <div className="cb">
          <span className="ttl">{d.short_name}</span>
          <span className="ln">
            <span className="sub">{d.category_label} · {d.flow_count} {supportsPpd(d) ? 'flows declared' : 'flows researched'}</span>
            {d.matter && <span className="tag">Matter</span>}
            {!inHome(d) && household.saved.includes(d.id) && <span className="tag">Saved</span>}
          </span>
        </div>
      </Link>
      {inHome(d) ? (
        <span className="tr"><span className="in"><SmallCheck />In your home</span></span>
      ) : (
        <button className="tr get" aria-label={`Add ${d.short_name}`} onClick={() => add(d)}><span>Add</span></button>
      )}
    </div>
  )

  // Research entries are advice only: adding one lists it in My Home, nothing connects to anything.
  const add = async (d: DeviceSummary) => {
    await addDevice(d.id)
    nav(`/device/${d.id}`)
  }

  return (
    <div className="screen">
      <AppBar title="Device library" back="/" />
      <div className="search">
        <label className="sr" htmlFor="q">Search devices</label>
        <Icon name="search" size={20} />
        <input id="q" type="search" placeholder="Search by name or model" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {connected.length > 0 && (
        <>
          <SectionHeader>Connected to your home gateway · {connected.length}</SectionHeader>
          <div className="grp">
            {connected.map((d) => (
              <Link key={d.id} to={open(d)} className="cell d">
                <DeviceTile device={d} />
                <div className="cb">
                  <span className="ttl">{d.short_name}</span>
                  <span className="ln">
                    <span className="sub">{d.category_label} · {d.flow_count} flows declared</span>
                    {d.kind === 'simulated' && <span className="tag sm">Simulated</span>}
                  </span>
                </div>
                {inHome(d) && <span className="tr"><span className="in"><SmallCheck />In your home</span></span>}
              </Link>
            ))}
          </div>
          <Footnote>These devices registered with your home gateway and declared what they do. Your rules are sent to them.</Footnote>
        </>
      )}

      {ppd.length > 0 && (
        <>
          <SectionHeader>Supports PPD · {ppd.length}</SectionHeader>
          <div className="grp">{ppd.map(row)}</div>
          <Footnote>These devices say what they do with your data. Open one to see where its data goes, compared with your household policy.</Footnote>
          <div className="grp" style={{ marginTop: 8 }}>
            <a className="cell" href="qr/index.html" target="_blank" rel="noreferrer">
              <div className="cb" style={{ padding: '12px 0' }}>
                <span className="ttl" style={{ color: 'var(--primary)' }}>PPD QR codes for these devices</span>
                <span className="sub">Printable codes. Scan one to open it in the privacy viewer.</span>
              </div>
            </a>
          </div>
        </>
      )}
      {other.length > 0 && (
        <>
          <SectionHeader>Doesn’t support PPD · {other.length}</SectionHeader>
          <div className="grp">{other.map(row)}</div>
          <Footnote>These devices can’t receive your rules or say what they do with your data. What you see comes from our team’s reading of the maker’s public privacy statements.</Footnote>
        </>
      )}
      {shown.length === 0 && <div className="empty">No match for “{q}”.</div>}
      <Footnote>Not listed? Scan the box, or wait for the device to register itself if it supports PPD.</Footnote>
      <div className="spacer" />
    </div>
  )
}
