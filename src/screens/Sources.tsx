import { AppBar, Cell, ErrorBox, Footnote, Group, Loading, SectionHeader } from '../components/ui'
import { useOnboarding } from '../state/data'

const REPO = 'https://github.com/baktistr/ppd-household-presets'

const SOURCES = [
  { citation: 'Smullen, Feng, Zhang, Sadeh 2020. The Best of Both Worlds: Mitigating Trade-offs Between Accuracy and User Burden in Capturing Mobile App Privacy Preferences. PoPETs 2020(1).', used: 'The method: profiles from clustering, a decision tree to place a household, follow-ups where a profile is unsure' },
  { citation: 'Apthorpe, Shvartzshnaider, Mathur, Reisman, Feamster 2018. Discovering Smart Home Internet of Things Privacy Norms Using Contextual Integrity. IMWUT 2(2).', used: 'How recipients, purposes, data and devices change what households accept' },
  { citation: 'Emami-Naeini et al. 2017. Privacy Expectations and Preferences in an IoT World. SOUPS 2017.', used: 'Data types at home, and how much households disagree' },
  { citation: 'Zhang, Feng, Bauer, Cranor, Das, Sadeh 2021. "Did you know this camera tracks your mood?" PoPETs 2021(2).', used: 'How purposes rank for video' },
  { citation: 'Liu et al. 2016. Follow My Recommendations: A Personalized Privacy Assistant for Mobile App Permissions. SOUPS 2016.', used: 'Questions about concrete settings; how consistent people are' },
]

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '–')
type Match = { one_preset?: number; after_profiling?: number; after_follow_ups?: number }

/** How the questions and the rules behind them were made, and from what. */
export default function Sources() {
  const { data: tree, error } = useOnboarding()
  if (error) return <><AppBar title="How the questions were made" back={true} /><ErrorBox error={error} /></>
  if (!tree) return <><AppBar title="How the questions were made" back={true} /><Loading /></>
  const s = tree.source
  const all = (s.match_all_items_cv ?? {}) as Match
  return (
    <div className="screen">
      <AppBar title="How the questions were made" back={true} />
      <div className="sf" style={{ paddingTop: 0 }}>
        Thousands of synthetic households, built from published studies of how people feel about smart-home data, each
        decided every combination of data, purpose, action, source and where the data goes. Households that decide alike
        were grouped; a decision tree learned which few situations tell the groups apart, and for each group which
        situations its households are split on. Your answers place you with households like yours, and every answer you
        give is written into your rules. These are synthetic households, not survey data, and not yet user-tested.
      </div>
      <Group>
        <div className="cell kv"><span className="ttl">Questions</span><span className="v">at most {s.total_questions_cap}</span></div>
        <div className="cell kv"><span className="ttl">Decisions matched: the same rules for everyone</span><span className="v">{pct(all.one_preset)}</span></div>
        <div className="cell kv"><span className="ttl">After the first questions</span><span className="v">{pct(all.after_profiling)}</span></div>
        <div className="cell kv"><span className="ttl">After the follow-up questions</span><span className="v">{pct(all.after_follow_ups)}</span></div>
      </Group>
      <Footnote>How often the rules give a synthetic household's own decision, over all 6,272 kinds of data flow, on households the tree was not fitted on. <a className="link" href={REPO} target="_blank" rel="noreferrer">Notebooks and data</a></Footnote>

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
      <Footnote>Version {tree.version} of the questions.</Footnote>
      <div className="spacer" />
    </div>
  )
}
