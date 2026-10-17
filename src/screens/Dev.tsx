import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader } from '../components/ui'
import { useHousehold, useLibrary } from '../state/data'

const MATTER_DECOY = 'MT:Y.K9042C00KA0648G00'

function Code({ payload, label }: { payload: string; label: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => { QRCode.toDataURL(payload, { margin: 1, width: 296, errorCorrectionLevel: 'M' }).then(setSrc) }, [payload])
  return (
    <div className="cell" style={{ padding: '12px 16px', gap: 14, alignItems: 'flex-start' }}>
      <div className="qr">{src ? <img src={src} alt={`QR code for ${label}`} /> : null}</div>
      <div className="cb" style={{ padding: 0 }}>
        <span className="ttl">{label}</span>
        <span className="mono">{payload}</span>
      </div>
    </div>
  )
}

/** Test tools: QR codes to point the camera at, household resets, and what this browser supports. */
export default function Dev() {
  const nav = useNavigate()
  const lib = useLibrary()
  const { household, resetDemo, addDevice, toast } = useHousehold()
  const [sw, setSw] = useState('checking…')

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return setSw('not supported')
    navigator.serviceWorker.getRegistration().then((r) => setSw(r ? (navigator.serviceWorker.controller ? 'active, controlling this page' : 'registered (reload to take control)') : 'not registered'))
  }, [])

  if (lib.error) return <><AppBar title="Test tools" back={true} /><ErrorBox error={lib.error} /></>
  if (!lib.data || !household) return <><AppBar title="Test tools" back={true} /><Loading /></>

  const notHome = lib.data.filter((d) => d.source === 'declared' && !household.devices.some((h) => h.device_id === d.id))
  const standalone = window.matchMedia('(display-mode: standalone)').matches
  const facts: [string, string][] = [
    ['Secure page (camera allowed)', window.isSecureContext ? 'yes' : 'no: use https:// or localhost'],
    ['Built-in QR detector', 'BarcodeDetector' in window ? 'yes (fast path)' : 'no (using the JavaScript decoder)'],
    ['Installed as an app', standalone ? 'yes' : 'no (running in the browser)'],
    ['Service worker', sw],
  ]

  return (
    <div className="screen">
      <AppBar title="Test tools" back={true} />
      <div className="sf" style={{ paddingTop: 0 }}>Point the Scan screen at these codes (from a second screen) to try the scanner. The codes are placeholders for what a real box would carry.</div>

      <SectionHeader>Privacy codes</SectionHeader>
      <Group>{lib.data.map((d) => <Code key={d.id} label={d.short_name} payload={`https://ppd.example/d/${d.declaration_id_example}`} />)}</Group>

      <SectionHeader>Should be refused</SectionHeader>
      <Group><Code label="A Matter setup code" payload={MATTER_DECOY} /></Group>
      <Footnote>The Scan screen explains that this is not the privacy code.</Footnote>

      <SectionHeader>Household</SectionHeader>
      <Group>
        <Cell onClick={async () => { await resetDemo('seed'); toast('Household reset to the fixture') }} chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="ttl">Reset to the demo household</span><span className="sub">Four devices, no saved decisions</span></div></Cell>
        <Cell onClick={async () => { await resetDemo('empty'); toast('Household emptied') }} chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="ttl">Start with an empty home</span><span className="sub">To try scanning and adding devices</span></div></Cell>
        {notHome.map((d) => (
          <Cell key={d.id} chevron={false} onClick={async () => { await addDevice(d.id, { joined: true }); nav(`/device/${d.id}/joined`) }}>
            <div className="cb" style={{ padding: '12px 0' }}><span className="ttl">Simulate {d.short_name} joining</span><span className="sub">Opens the “joined your home” screen</span></div>
          </Cell>
        ))}
      </Group>

      <SectionHeader>This browser</SectionHeader>
      <Group>{facts.map(([k, v]) => <div key={k} className="cell kv"><span className="ttl" style={{ fontSize: 14 }}>{k}</span><span className="v" style={{ fontSize: 14 }}>{v}</span></div>)}</Group>
      <div className="spacer" />
    </div>
  )
}
