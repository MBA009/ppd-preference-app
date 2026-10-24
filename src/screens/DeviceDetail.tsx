import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { AppBar, Cell, DeviceTile, ErrorBox, Group, Loading, SectionHeader } from '../components/ui'
import { AttentionList, ProvenanceCard } from '../components/DeviceReport'
import { AssociationCard, IdentityAndNetwork, LifecycleSteps, PolicyReceipt, ReportedBehavior } from '../components/LiveDevice'
import { useDevice, useHousehold, useMe, useRules } from '../state/data'
import { STATE_LABEL, forgetBlocker, isConnected, kindLabel, subtitle, timeAgo } from '../lib/device'

/** Screen 3c. For a device the PPD gateway knows, it also shows the gateway's live view of it. */
export default function DeviceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { household, removeDevice, addDevice, toast, reload } = useHousehold()
  const dev = useDevice(id, true)
  const rules = useRules(true)
  const { data: me } = useMe()

  if (dev.error && !dev.data) return <><AppBar title="Device" back="/" /><ErrorBox error={dev.error} /></>
  const d = dev.data
  if (!d || !household) return <><AppBar title="Device" back="/" /><Loading /></>

  const inHome = household.devices.some((h) => h.device_id === d.id)
  const ruleCount = rules.length
  const decl = d.declaration
  const live = d.live
  const operator = me?.role === 'operator'

  const disassociate = async () => {
    if (!window.confirm(`Ask ${d.short_name} to reconnect? It will receive and confirm your rules again.`)) return
    try {
      await api.disassociate(d.id)
      toast('The device will reconnect.')
      dev.reload()
    } catch (e) {
      toast((e as Error).message)
    }
  }

  const blocker = forgetBlocker(d)
  const forget = async () => {
    if (!window.confirm(`Forget ${d.short_name}? The home gateway deletes its records and your decisions for it. If it comes back, it joins as a new device.`)) return
    try {
      await api.forgetDevice(d.id)
      reload()
      toast(`${d.short_name} was forgotten.`)
      nav('/')
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Device" back="/" />
      <Group style={{ marginTop: 4 }}>
        <Cell className="t" chevron={false} style={{ padding: '14px 16px' }}>
          <DeviceTile device={d} size="hero" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 500 }}>{d.short_name}</div>
            <div className="sub">{subtitle(d, live ? kindLabel(d) : d.kind === 'research' ? 'Advisory · not connected' : decl ? 'Gets your rules' : 'Advisory only')}</div>
          </div>
        </Cell>
      </Group>
      <div className="gap" />
      {live && (
        <>
          <AssociationCard live={live} />
          <div className="gap" />
        </>
      )}
      <ProvenanceCard device={d} ruleCount={ruleCount} />
      <div className="sf" style={{ fontStyle: 'italic' }}>We can’t check that the device will follow your rules.</div>

      <AttentionList device={d} />

      {live ? (
        <>
          <PolicyReceipt live={live} />
          <LifecycleSteps live={live} />
          <ReportedBehavior live={live} />
          {operator && (
            <div className="sf"><Link to={`/demo-devices/${encodeURIComponent(d.id)}`} className="link">Device console (demo)</Link></div>
          )}
          <IdentityAndNetwork live={live} />
        </>
      ) : (
        decl && d.kind !== 'research' && (
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
        )
      )}

      <div className="gap" />
      <Group>
        {live && operator && (
          <Cell className="t" chevron={false} onClick={disassociate}>
            <div className="cb" style={{ padding: '12px 0' }}><span className="ttl" style={{ color: '#0066CC' }}>Ask the device to reconnect</span><span className="sub">Its association ends until it confirms your rules again</span></div>
          </Cell>
        )}
        {live && operator && (
          <Cell className="t" chevron={false} onClick={blocker ? undefined : forget} aria-disabled={!!blocker}>
            <div className="cb" style={{ padding: '12px 0' }}>
              <span className="ttl" style={{ color: blocker ? '#9AA0A6' : '#D70015' }}>Forget this device</span>
              <span className="sub">{blocker ?? 'It has left your network. Delete it from the home gateway and your home.'}</span>
            </div>
          </Cell>
        )}
        {isConnected(d) ? null : inHome ? (
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
