import { AppBar, ErrorBox, Footnote, Group, Loading, SectionHeader, Tile } from '../components/ui'
import { Icon } from '../components/icons'
import { useOnboarding } from '../state/data'

const REPO = 'https://github.com/baktistr/ppd-household-presets'

type Source = { title: string; by: string; used?: string; about?: string; pdf?: string }

const SOURCES: Source[] = [
  { title: 'The Best of Both Worlds: Mitigating Trade-offs Between Accuracy and User Burden in Capturing Mobile App Privacy Preferences', by: 'Smullen, Feng, Zhang, Sadeh · PoPETs 2020(1)', used: 'The method: profiles from clustering, a decision tree to place a household, follow-ups where a profile is unsure' },
  { title: 'Discovering Smart Home Internet of Things Privacy Norms Using Contextual Integrity', by: 'Apthorpe, Shvartzshnaider, Mathur, Reisman, Feamster · IMWUT 2(2), 2018', used: 'How recipients, purposes, data and devices change what households accept' },
  { title: 'Privacy Expectations and Preferences in an IoT World', by: 'Emami-Naeini et al. · SOUPS 2017', used: 'Data types at home, and how much households disagree' },
  { title: '"Did you know this camera tracks your mood?"', by: 'Zhang, Feng, Bauer, Cranor, Das, Sadeh · PoPETs 2021(2)', used: 'How purposes rank for video' },
  { title: 'Follow My Recommendations: A Personalized Privacy Assistant for Mobile App Permissions', by: 'Liu et al. · SOUPS 2016', used: 'Questions about concrete settings; how consistent people are', pdf: 'https://www.usenix.org/system/files/conference/soups2016/soups2016-paper-liu.pdf' },
]

/** Related work on the same idea. No figure in the synthetic households comes from these, so they get no "Used for". */
const BACKGROUND: Source[] = [
  { title: "Modeling Users' Mobile App Privacy Preferences: Restoring Usability in a Sea of Permission Settings", by: 'Lin, Liu, Sadeh, Hong · SOUPS 2014', about: 'A small number of privacy profiles can capture what people want from mobile apps', pdf: 'https://www.usenix.org/system/files/conference/soups2014/soups14-paper-lin.pdf' },
  { title: 'Reconciling Mobile App Privacy and Usability on Smartphones: Could User Privacy Profiles Help?', by: 'Liu, Lin, Sadeh · WWW 2014', about: 'Whether a few profiles can make app permission settings easier', pdf: 'https://www.cs.cmu.edu/~bliu1/Bin_Liu_WWW2014_Reconciling.pdf' },
  { title: "Understanding People's Privacy Attitudes Towards Video Analytics Technologies", by: 'Zhang, Feng, Das, Bauer, Cranor, Sadeh · Technical report CMU-ISR-20-114, Carnegie Mellon University, 2020', about: 'How people feel about video analytics, and profiles that predict what they allow or deny', pdf: 'http://reports-archive.adm.cs.cmu.edu/anon/isr2020/CMU-ISR-20-114.pdf' },
]

const STEPS = [
  { title: 'Build synthetic households', text: 'Thousands of synthetic households, built from published studies of how people feel about smart-home data, each decided every combination of data, purpose, action, source and where the data goes.' },
  { title: 'Group households that decide alike', text: 'A decision tree learned which few situations tell the groups apart, and for each group which situations its households are split on.' },
  { title: 'Place you with households like yours', text: 'Your answers place you in a group, and every answer you give is written into your rules.' },
]

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '–')
type Match = { one_preset?: number; after_profiling?: number; after_follow_ups?: number }

/** A paper. With a PDF the whole row is the link, so the tap target is the row and not a line of text. */
function SourceRow({ source: x }: { source: Source }) {
  const body = (
    <div className="cb" style={{ padding: '12px 0', paddingRight: x.pdf ? 0 : 16 }}>
      <span className="ttl" style={{ fontSize: 15, lineHeight: '20px', fontWeight: 500 }}>{x.title}</span>
      <span className="sub" style={{ fontSize: 13, lineHeight: '18px', marginTop: 2 }}>{x.by}</span>
      <span className="sub" style={{ marginTop: 6 }}>{x.used ? `Used for: ${x.used}` : x.about}</span>
      {x.pdf && <span className="link" style={{ marginTop: 6, fontWeight: 500 }}>Read the PDF</span>}
    </div>
  )
  if (!x.pdf) return <div className="cell">{body}</div>
  return (
    <a className="cell" href={x.pdf} target="_blank" rel="noreferrer">
      {body}
      <span className="tr"><Icon name="external" size={20} /></span>
    </a>
  )
}

/** How the questions and the rules behind them were made, and from what. */
export default function Sources() {
  const { data: tree, error } = useOnboarding()
  if (error) return <><AppBar title="How the questions were made" back={true} /><ErrorBox error={error} /></>
  if (!tree) return <><AppBar title="How the questions were made" back={true} /><Loading /></>
  const s = tree.source
  const all = (s.match_all_items_cv ?? {}) as Match
  const stats = [
    [String(s.total_questions_cap), 'The most questions you will be asked'],
    [pct(all.one_preset), 'Decisions matched by the same rules for everyone'],
    [pct(all.after_profiling), 'Matched after the first questions'],
    [pct(all.after_follow_ups), 'Matched after the follow-up questions'],
  ]
  return (
    <div className="screen">
      <AppBar title="How the questions were made" back={true} />

      <SectionHeader>How it works</SectionHeader>
      <Group>
        {STEPS.map((step, i) => (
          <div key={step.title} className="cell t" style={{ alignItems: 'flex-start' }}>
            <Tile tone="blue" style={{ marginTop: 12, fontSize: 15, fontWeight: 500 }}>{i + 1}</Tile>
            <div className="cb" style={{ padding: '12px 16px 12px 0' }}>
              <span className="ttl" style={{ fontWeight: 500 }}>{step.title}</span>
              <span className="sub" style={{ marginTop: 2 }}>{step.text}</span>
            </div>
          </div>
        ))}
      </Group>
      <Footnote>These are synthetic households, not survey data, and not yet user-tested.</Footnote>

      <SectionHeader>How close the rules get</SectionHeader>
      <Group>
        <div className="stats">
          {stats.map(([n, label]) => (
            <div key={label} className="stat"><span className="n">{n}</span><span className="sub">{label}</span></div>
          ))}
        </div>
      </Group>
      <Footnote>How often the rules give a synthetic household's own decision, over all 6,272 kinds of data flow, on households the tree was not fitted on.</Footnote>
      <div className="gap" />
      <Group>
        <a className="cell" href={REPO} target="_blank" rel="noreferrer">
          <div className="cb"><span className="ttl" style={{ color: 'var(--primary)', fontWeight: 500 }}>Notebooks and data</span></div>
          <span className="tr"><Icon name="external" size={20} /></span>
        </a>
      </Group>

      <SectionHeader>Sources</SectionHeader>
      <Group>{SOURCES.map((x) => <SourceRow key={x.title} source={x} />)}</Group>

      <SectionHeader>Background reading</SectionHeader>
      <Group>{BACKGROUND.map((x) => <SourceRow key={x.title} source={x} />)}</Group>
      <Footnote>Earlier work on privacy profiles, most of it on mobile apps. None of the numbers behind the rules come from these.</Footnote>
      <Footnote>Version {tree.version} of the questions.</Footnote>
      <div className="spacer" />
    </div>
  )
}
