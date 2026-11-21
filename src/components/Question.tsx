
import type { OnboardingQuestion } from '../../shared/types'
import { CORE_TERMS } from '../../shared/taxonomy'
import { questionText } from '../../shared/onboarding'
import { Icon } from './icons'

/** Where the data goes, as a short tag. */
const GOES: Record<string, string> = {
  'ppd:householdContext': 'Stays in your home', 'ppd:vendorContext': 'The device maker',
  'ppd:thirdPartyContext': 'Other companies', 'ppd:publicAudience': 'Made public',
}

/** Each answer with what it does to the household's rules. "Not sure" keeps the recommendation. */
const OPTIONS: Record<string, { help: string; tone: 'no' | 'unsure' | 'yes' }> = {
  no: { help: 'Don’t allow this', tone: 'no' },
  depends: { help: 'Use what households like yours chose', tone: 'unsure' },
  yes: { help: 'Allow this', tone: 'yes' },
}

const Unsure = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.2 9a3 3 0 0 1 5.6 1.3c0 2-2.8 2.4-2.8 4.2" /><circle cx="12" cy="18.4" r="0.6" fill="currentColor" />
  </svg>
)

/**
 * One situation question, as the questionnaire and "Fine-tune your profile" both show it: what the situation is about
 * at a glance, the question, an example, and the answers as cards that say what each one does.
 */
export function QuestionView({ q, owned, chosen, onPick, tour }: {
  q: OnboardingQuestion; owned: string[]; chosen: string | null; onPick: (id: string) => void; tour?: string
}) {
  const { text, example } = questionText(q, owned)
  const s = q.situation
  return (
    <>
      <div className="q">
        {s && (
          <div className="q-tags">
            <span className="q-tag"><b>What</b> {CORE_TERMS.data_type[s.data_type]}</span>
            <span className="q-tag"><b>Goes to</b> {GOES[s.handling_context] ?? CORE_TERMS.handling_context[s.handling_context]}</span>
            <span className="q-tag"><b>Why</b> {CORE_TERMS.purpose[s.purpose]}</span>
          </div>
        )}
        <h2>{text}</h2>
        {example && <div className="q-eg"><b>For example</b>{example.charAt(0).toUpperCase() + example.slice(1)}.</div>}
      </div>
      <div className="opts" role="radiogroup" aria-label={text} data-tour={tour}>
        {q.options.map((o) => {
          const look = OPTIONS[o.id]
          const on = chosen === o.id
          return (
            <button key={o.id} className={`opt ${look?.tone ?? ''}${on ? ' on' : ''}`} role="radio" aria-checked={on} onClick={() => onPick(o.id)}>
              <span className="opt-ico">{look?.tone === 'no' ? <Icon name="block" size={18} /> : look?.tone === 'yes' ? <Icon name="check" size={18} /> : <Unsure />}</span>
              <span className="opt-txt"><span className="opt-t">{o.label}</span>{look && <span className="opt-s">{look.help}</span>}</span>
              <span className={'rd' + (on ? ' on' : '')} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </>
  )
}
