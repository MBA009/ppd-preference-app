import { Link } from 'react-router-dom'
import { AppBar, Cell, ErrorBox, Group, Loading, SectionHeader, Tile } from '../components/ui'
import { Icon } from '../components/icons'
import { useHousehold, useRules } from '../state/data'
import { plural } from '../lib/verdicts'

/** Screen 3d. Read-only for now: rules come from public/mock/rules.json. */
export default function Rules() {
  const { data: rules, error } = useRules()
  const { household, toast } = useHousehold()
  const soon = () => toast('Adding and editing rules is not built yet.')

  if (error) return <><AppBar title="Household rules" /><ErrorBox error={error} /></>
  if (!rules || !household) return <><AppBar title="Household rules" /><Loading /></>

  const homeIds = household.devices.map((d) => d.device_id)
  const count = (r: (typeof rules)[number]) => (r.applies_to === 'all' ? homeIds.length : homeIds.filter((i) => r.applies_to.includes(i)).length)

  return (
    <div className="screen">
      <AppBar title="Household rules" right={<button className="ntr" aria-label="Add a rule" onClick={soon}><Icon name="plus" /></button>} />
      <div className="sf" style={{ paddingTop: 0 }}>
        Rules are what you ask devices to follow. Devices that get your rules pick up a change the next time they renew. Advisory devices are re-checked right away.
      </div>

      <SectionHeader>Your rules · {rules.length}</SectionHeader>
      <Group>
        {rules.map((r) => (
          <Cell key={r.id} onClick={soon} chevron={false}>
            <div className="cb">
              <span className="ttl">{r.title}</span>
              <span className="sub">{plural(count(r), 'device')}</span>
            </div>
            <span className="tr" style={{ fontSize: 14, lineHeight: '20px', fontWeight: 500, color: r.effect === 'allow' ? '#1E7D34' : '#444A52' }}>
              {r.effect === 'allow' ? 'Allow' : 'Don’t allow'}
            </span>
          </Cell>
        ))}
      </Group>
      <div className="gap" />
      <Group>
        <Cell className="t" onClick={soon} chevron={false}>
          <Tile tone="blue"><Icon name="plus" size={18} /></Tile>
          <div className="cb"><span className="ttl" style={{ color: '#0066CC' }}>Add a rule</span></div>
        </Cell>
      </Group>
      <div className="spacer" />
      <div className="sf" style={{ textAlign: 'center', padding: '16px 32px 4px' }}><Link to="/dev" className="link" style={{ fontSize: 13 }}>Test tools</Link></div>
    </div>
  )
}
