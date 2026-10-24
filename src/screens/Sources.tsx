import { AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader } from '../components/ui'
import { useOnboarding } from '../state/data'

const REPO = 'https://github.com/baktistr/ppd-household-presets'

const SOURCES = [
  { citation: 'Smullen, Feng, Zhang, Sadeh 2020. The Best of Both Worlds: Mitigating Trade-offs Between Accuracy and User Burden in Capturing Mobile App Privacy Preferences. PoPETs 2020(1).', used: 'The method: profiles from clustering, a decision tree to pick one' },
  { citation: 'Emami-Naeini et al. 2017. Privacy Expectations and Preferences in an IoT World. SOUPS 2017.', used: 'How households weigh data types, purposes and recipients' },
  { citation: 'Emami-Naeini et al. 2020. Ask the Experts: What Should Be on an IoT Privacy and Security Label? IEEE S&P 2020.', used: 'Which practices matter to people' },
  { citation: 'Emami-Naeini et al. 2021. Which Privacy and Security Attributes Most Impact Consumers’ Risk Perception and Willingness to Purchase IoT Devices? IEEE S&P 2021.', used: 'How strongly each practice moves risk perception' },
]

const pct = (v: string | number | undefined) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '–')

/** How the household presets and the onboarding questions were made, and from what. */
export default function Sources() {
  const { data: tree, error } = useOnboarding()
  if (error) return <><AppBar title="How the presets were made" back={true} /><ErrorBox error={error} /></>
  if (!tree) return <><AppBar title="How the presets were made" back={true} /><Loading /></>
  const s = tree.source
  return (
    <div className="screen">
      <AppBar title="How the presets were made" back={true} />
      <div className="sf" style={{ paddingTop: 0 }}>{tree.disclaimer}</div>
      <Group>
        <div className="cell kv"><span className="ttl">Presets</span><span className="v">{s.k}</span></div>
        <div className="cell kv"><span className="ttl">Questions</span><span className="v">at most {s.questions_max}</span></div>
        <div className="cell kv"><span className="ttl">Device flows matched (one preset for everyone)</span><span className="v">{pct(s.one_preset_for_everyone_cv)}</span></div>
        <div className="cell kv"><span className="ttl">Device flows matched (your preset)</span><span className="v">{pct(s.match_real_device_flows_cv)}</span></div>
      </Group>
      <Footnote>Thousands of synthetic households each decided every combination of data, purpose, action, source and recipient. Households that decide alike were grouped; each group became a preset; a decision tree learned which few questions tell the groups apart. <a className="link" href={REPO} target="_blank" rel="noreferrer">Notebooks and data</a></Footnote>

      <SectionHeader>Sources</SectionHeader>
      <Group>
        {SOURCES.map((x) => (
          <Cell key={x.citation} chevron={false} style={{ alignItems: 'flex-start' }}>
            <div className="cb" style={{ padding: '12px 0' }}>
              <span className="ttl" style={{ fontSize: 15, lineHeight: '20px' }}>{x.citation}</span>
              <span className="sub" style={{ marginTop: 4 }}>Used for: {x.used}</span>
            </div>
          </Cell>
        ))}
      </Group>
      <Footnote>Version {tree.version} of the questions and presets.</Footnote>
      <div className="spacer" />
    </div>
  )
}
