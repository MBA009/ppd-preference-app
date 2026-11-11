import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionBar, AppBar, DeviceTile, ErrorBox, Group, Loading, Cell, SectionHeader } from '../components/ui'
import { AttentionList, PpdStatus, ProvenanceCard } from '../components/DeviceReport'
import { useDevice, useHousehold } from '../state/data'
import { declaredNothing, subtitle, supportsPpd } from '../lib/device'
import { DataflowDiagram, contextSplit } from '../components/DataflowDiagram'

/** Screens 1b (declared device) and 1c (researched device): what a device says, before it joins the home. */
export default function Preview() {
  const { id } = useParams()
  const nav = useNavigate()
  const { household, saveForLater, toast } = useHousehold()
  const dev = useDevice(id)
  // Back to where it was opened from (the device library, or Scan); a link opened directly goes to Scan.
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav('/scan'))

  if (dev.error) return <><AppBar title="Check a device" back={back} /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="Check a device" back={back} /><Loading /></>

  const inHome = household.devices.some((h) => h.device_id === d.id)
  const saved = household.saved.includes(d.id)

  return (
    <div className="screen">
      <AppBar title="Check a device" back={back} />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>{d.short_name}</div>
            <div className="sub">{subtitle(d, inHome ? 'In your home' : 'Not in your home yet')}</div>
          </div>
        </Cell>
        <PpdStatus device={d} />
      </Group>
      <div className="gap" />
      {supportsPpd(d) && !declaredNothing(d) && d.flows.length > 0 && (
        <>
          <SectionHeader>Where its data goes</SectionHeader>
          <Group>
            <Link to={`/viewer/${d.id}`} className="df-peek" aria-label={`Open the privacy viewer for ${d.short_name}`}>
              <DataflowDiagram device={d} pick={null} compact />
            </Link>
            <Cell className="t" to={`/viewer/${d.id}`}>
              <div className="cb">
                <span className="ttl">Open the privacy viewer</span>
                <span className="sub">{contextSplit(d).map((s) => `${s.n} ${s.label[0].toLowerCase() + s.label.slice(1)}`).join(' · ')}</span>
              </div>
            </Cell>
          </Group>
          <div className="gap" />
        </>
      )}
      <ProvenanceCard device={d} />
      <AttentionList device={d} />
      <div className="spacer" />
      <ActionBar>
        <Link to="/scan" className="btn2">Scan another box</Link>
        {inHome ? (
          <Link to={`/device/${d.id}`} className="btn">Open device</Link>
        ) : (
          <button className="btn" disabled={saved} onClick={async () => { await saveForLater(d.id); toast('Saved. You will find it in the device library.'); nav('/library') }}>
            {saved ? 'Saved' : 'Save for later'}
          </button>
        )}
      </ActionBar>
    </div>
  )
}

