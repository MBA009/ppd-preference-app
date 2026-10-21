import { AppBar, Cell, ErrorBox, Footnote, Group, Loading } from '../components/ui'
import { useQuestionnaire } from '../state/data'

/** The papers the household questions were derived from. */
export default function Sources() {
  const { data: tree, error } = useQuestionnaire()
  if (error) return <><AppBar title="Sources" back="/rules" /><ErrorBox error={error} /></>
  if (!tree) return <><AppBar title="Sources" back="/rules" /><Loading /></>
  const used = (id: string) => tree.questions.filter((q) => q.sources.includes(id)).map((q) => q.short)
  return (
    <div className="screen">
      <AppBar title="Sources" back="/rules" />
      <div className="sf" style={{ paddingTop: 0 }}>{tree.disclaimer}</div>
      <Group>
        {Object.entries(tree.sources).map(([id, s]) => (
          <Cell key={id} chevron={false} style={{ alignItems: 'flex-start' }}>
            <div className="cb" style={{ padding: '12px 0' }}>
              <span className="ttl" style={{ fontSize: 15, lineHeight: '20px' }}>{s.citation}</span>
              <span className="sub" style={{ marginTop: 4 }}>Used for: {used(id).join(', ')}</span>
              <span className="sub" style={{ marginTop: 6 }}>
                <a className="link" href={s.url} target="_blank" rel="noreferrer">Paper page</a>
                {s.pdf && <> · <a className="link" href={s.pdf} target="_blank" rel="noreferrer">PDF</a></>}
              </span>
            </div>
          </Cell>
        ))}
      </Group>
      <Footnote>Version {tree.version} of the questions.</Footnote>
    </div>
  )
}
