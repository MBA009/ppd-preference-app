import type { ReactNode } from 'react'

/**
 * A list beside its detail on desktop. On phones only one pane shows: the list on list routes
 * (`mode="list"`), the detail on detail routes, exactly as before.
 */
export function Split({ mode, list, detail, placeholder }: { mode: 'list' | 'detail'; list: ReactNode; detail: ReactNode; placeholder?: string }) {
  return (
    <div className={`split mode-${mode}`}>
      <section className="pane pane-list" aria-label="List">{list}</section>
      <section className="pane pane-detail" aria-label="Details">
        {detail ?? <div className="empty pane-empty">{placeholder}</div>}
      </section>
    </div>
  )
}
