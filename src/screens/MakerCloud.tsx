import { AppBar, Cell, DeviceTile, ErrorBox, Footnote, Group, Loading } from '../components/ui'
import { DemoControls, TelemetryCard } from '../components/LiveDevice'
import { useDevices, useHousehold, useMe } from '../state/data'

/**
 * Stands in for the device maker's own app and cloud, for the demo: what a real device (the ESP32 bulb)
 * uploaded, and remote controls for the presenter. None of this is PPD: the protocol only delivers the
 * household's rules and records that the device received them. It cannot see or control what a device
 * sends, so this page shows the effect of the rules from the other side.
 */
export default function MakerCloud() {
  const { household } = useHousehold()
  const ids = household?.devices.map((d) => d.device_id) ?? []
  const { data: devices, error } = useDevices(ids, true)
  const { data: me } = useMe()

  if (error && !devices) return <><AppBar title="Device maker’s cloud" back={true} /><ErrorBox error={error} /></>
  if (!devices) return <><AppBar title="Device maker’s cloud" back={true} /><Loading /></>
  const real = devices.filter((d) => d.live?.kind === 'real')

  return (
    <div className="screen">
      <AppBar title="Device maker’s cloud" subtitle="Demo" back={true} />
      <div className="sf" style={{ paddingTop: 0 }}>
        This page plays the device maker’s own app and cloud. It is not part of PPD or of the household’s app: PPD only
        delivers the household’s rules and records that the device received them. Here you can see what the device
        actually uploaded, for example analytics stopping when the rules say no.
      </div>
      {!real.length && (
        <Group><Cell chevron={false}><div className="cb" style={{ padding: '12px 0' }}><span className="ttl">No real device is connected</span><span className="sub">The ESP32 smart bulb shows up here once it joins the home.</span></div></Cell></Group>
      )}
      {real.map((d) => (
        <div key={d.id}>
          <Group style={{ marginTop: 12 }}>
            <Cell className="d" to={`/device/${d.id}`}>
              <DeviceTile device={d} />
              <div className="cb"><span className="ttl">{d.short_name}</span><span className="sub">{d.name}</span></div>
            </Cell>
          </Group>
          <TelemetryCard device={d} />
          {me?.role === 'operator' && <DemoControls device={d} />}
        </div>
      ))}
      <Footnote>Uploads and commands go through the gateway’s demo extension (/ppd-demo/v1), not through PPD.</Footnote>
      <div className="spacer" />
    </div>
  )
}
