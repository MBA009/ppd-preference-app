import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppBar, Cell, DeviceTile, ErrorBox, Group, Loading, SectionHeader } from '../components/ui'
import { AttentionList, ProvenanceCard } from '../components/DeviceReport'
import { useDevice, useHousehold, useRules } from '../state/data'
import { rulesFor, STATE_LABEL, subtitle, timeAgo } from '../lib/device'
import { decidedCount } from '../lib/verdicts'

/** Screen 3c. */
export default function DeviceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { household, removeDevice, addDevice, toast } = useHousehold()
  const dev = useDevice(id)
  const rules = useRules()

  if (dev.error) return <><AppBar title="Device" back="/" /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="Device" back="/" /><Loading /></>

  const inHome = household.devices.some((h) => h.device_id === d.id)
  const ruleCount = rulesFor(rules.data ?? [], d.id).length
  const decided = decidedCount(d, household)
  const decl = d.declaration

  return (
    <div className="screen">
      <AppBar title="Device" back="/" />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>{d.short_name}</div>
            <div className="sub">{subtitle(d, decl ? 'Gets your rules' : 'Advisory only')}</div>
          </div>
        </Cell>
      </Group>
      <div className="gap" />
      <ProvenanceCard device={d} household={household} ruleCount={ruleCount} />
      <div className="sf" style={{ fontStyle: 'italic' }}>We can’t check that the device will follow your rules.</div>
      {decided > 0 && <div className="sf">{decided} {decided === 1 ? 'decision' : 'decisions'} made by you.</div>}

      <AttentionList device={d} household={household} />

      {decl && (
        <>
          <SectionHeader>About this declaration</SectionHeader>
          <Group>
            <div className="cell kv"><span className="ttl">Rules status</span><span className="v">{STATE_LABEL[decl.state].replace('Gets your rules · ', '')}</span></div>
            <div className="cell kv"><span className="ttl">Declaration received</span><span className="v">{timeAgo(decl.received_at)}</span></div>
            <div className="cell kv"><span className="ttl">Renews by</span><span className="v">{new Date(decl.renew_by).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
            <div className="cell kv"><span className="ttl">Statements</span><span className="v">{decl.statements}</span></div>
          </Group>
          <div className="sf">“Confirmed” means the device said it received your rules. It is not proof that it follows them.</div>
        </>
      )}

      <div className="gap" />
      <Group>
        {inHome ? (
          <Cell className="t" chevron={false} onClick={async () => { if (window.confirm(`Remove ${d.short_name} from your home?`)) { await removeDevice(d.id); toast('Removed from your home'); nav('/') } }}>
            <div className="cb" style={{ padding: '12px 0' }}><span className="ttl" style={{ color: '#D70015' }}>Remove from my home</span></div>
          </Cell>
        ) : (
          <Cell className="t" chevron={false} onClick={async () => { await addDevice(d.id, { joined: d.source === 'declared' }); toast('Added to your home') }}>
            <div className="cb" style={{ padding: '12px 0' }}><span className="ttl" style={{ color: '#0066CC' }}>Add to my home</span></div>
          </Cell>
        )}
      </Group>
      <div className="sf"><Link to="/library" className="link">Device library</Link></div>
      <div className="spacer" />
    </div>
  )
}
