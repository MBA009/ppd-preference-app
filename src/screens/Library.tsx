import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { DeviceSummary } from '../api'
import { AppBar, DeviceTile, ErrorBox, Footnote, Loading, SectionHeader } from '../components/ui'
import { Icon, SmallCheck } from '../components/icons'
import { useHousehold, useLibrary } from '../state/data'

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

  const add = async (d: DeviceSummary) => {
    const declared = d.source === 'declared'
    await addDevice(d.id, { joined: declared })
    nav(declared ? `/device/${d.id}/joined` : `/device/${d.id}`)
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
              <Link key={d.id} to={`/device/${encodeURIComponent(d.id)}`} className="cell d">
                <DeviceTile device={d} />
                <div className="cb">
                  <span className="ttl">{d.short_name}</span>
                  <span className="ln">
                    <span className="sub">{d.category_label} · {d.flow_count} flows declared</span>
                    {d.kind === 'simulated' && <span className="tag">Simulated</span>}
                  </span>
                </div>
                {inHome(d) && <span className="tr"><span className="in"><SmallCheck />In your home</span></span>}
              </Link>
            ))}
          </div>
          <Footnote>These devices registered with your home gateway and declared what they do. Your rules are sent to them.</Footnote>
        </>
      )}

      <div className="sf" style={{ paddingTop: 10 }}><b>Library devices are advisory.</b> Verdicts come from our research of vendor sources, and nothing is sent to the device.</div>

      <SectionHeader>Researched devices · {shown.length}</SectionHeader>
      <div className="grp">
        {shown.map((d) => (
          <div key={d.id} className="cell d">
            <Link to={`/preview/${d.id}`} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, color: 'inherit' }}>
              <DeviceTile device={d} />
              <div className="cb">
                <span className="ttl">{d.short_name}</span>
                <span className="ln">
                  <span className="sub">{d.category_label} · {d.flow_count} flows</span>
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
        ))}
        {shown.length === 0 && <div className="empty">No match for “{q}”.</div>}
      </div>
      <Footnote>Not listed? Scan the box, or wait for the device to register itself if it supports PPD.</Footnote>
      <div className="spacer" />
    </div>
  )
}
