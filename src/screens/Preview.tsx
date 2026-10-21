import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionBar, AppBar, DeviceTile, ErrorBox, Group, Loading, Cell } from '../components/ui'
import { AttentionList, ProvenanceCard } from '../components/DeviceReport'
import { useDevice, useHousehold, useRules } from '../state/data'
import { subtitle } from '../lib/device'

/** Screens 1b (declared device) and 1c (researched device): what a device says, before it joins the home. */
export default function Preview() {
  const { id } = useParams()
  const nav = useNavigate()
  const { household, saveForLater, toast } = useHousehold()
  const dev = useDevice(id)
  const rules = useRules(true)

  if (dev.error) return <><AppBar title="Preview" back="/scan" /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="Preview" back="/scan" /><Loading /></>

  const inHome = household.devices.some((h) => h.device_id === d.id)
  const saved = household.saved.includes(d.id)
  const ruleCount = rules.length

  return (
    <div className="screen">
      <AppBar title="Preview" back="/scan" />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>{d.short_name}</div>
            <div className="sub">{subtitle(d, inHome ? 'In your home' : 'Not in your home yet')}</div>
          </div>
        </Cell>
      </Group>
      <div className="gap" />
      <ProvenanceCard device={d} household={household} ruleCount={ruleCount} />
      {d.source === 'declared' && <div className="sf" style={{ fontStyle: 'italic' }}>We can’t check that the device will follow your rules.</div>}
      <AttentionList device={d} household={household} />
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

