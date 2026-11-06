import { useState } from 'react'
import { AppBar, Footnote, Loading, Segmented } from '../components/ui'
import { useHousehold, usePublished } from '../state/data'

type View = 'household' | 'ppd'

/**
 * The rules as raw JSON: the household's own rules (what the app stores and edits), or the PPD policy the gateway
 * serves to devices, compiled from them.
 */
export default function RulesJson() {
  const { household, toast } = useHousehold()
  const published = usePublished()
  const [view, setView] = useState<View>('household')
  if (!household) return <><AppBar title="Rules as JSON" back="/rules" /><Loading /></>

  const value = view === 'household'
    ? { answers: household.answers, rules: household.rules }
    : published.data ?? null
  const text = JSON.stringify(value, null, 2)
  const name = view === 'household' ? 'household-rules.json' : `${published.data?.policy_id ?? 'policy'}.json`

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied') } catch { toast('Could not copy') }
  }
  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="screen">
      <AppBar title="Rules as JSON" back="/rules" />
      <div style={{ padding: '0 16px 12px' }}>
        <Segmented full label="Which rules" value={view} onChange={setView}
          options={[{ value: 'household', label: `Household rules (${household.rules.length})` }, { value: 'ppd', label: `Sent to devices (${published.data?.rules.length ?? 0})` }]} />
      </div>
      <div className="sf" style={{ paddingTop: 0, paddingBottom: 10 }}>
        {view === 'household'
          ? 'What the app stores: your answers to the questions, and your rules.'
          : published.data ? 'The PPD policy the gateway serves: one rule for each kind of data flow your devices declare.' : 'Nothing has been sent to your devices yet.'}
      </div>
      {(view === 'household' || published.data) && <pre className="json">{text}</pre>}
      <Footnote>
        <button className="link" onClick={copy}>Copy</button>{' · '}
        <button className="link" onClick={download}>Download {name}</button>
      </Footnote>
      <div className="spacer" />
    </div>
  )
}
