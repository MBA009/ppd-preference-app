import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { blankHousehold } from '../../shared/household'
import type { Household } from '../../shared/types'

/**
 * The household store: one demo household, kept as a single document with a revision counter, plus an
 * audit log of every change. Node's built-in SQLite is synchronous, so each update is read, changed and
 * written without another request in between.
 */
export class HouseholdStore {
  private readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS household (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        doc TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT
      );
    `)
  }

  /** The stored household, or null before the first write. */
  get(): Household | null {
    const row = this.db.prepare('SELECT doc FROM household WHERE id = 1').get() as { doc: string } | undefined
    // Older documents may lack newer fields; fill them in.
    return row ? { ...blankHousehold(), ...(JSON.parse(row.doc) as Partial<Household>) } : null
  }

  /** Applies `change` to the current household (or `initial()` if there is none yet) and stores the result. */
  update(action: string, initial: () => Household, change: (h: Household) => Household, detail?: string): Household {
    const next = change(this.get() ?? initial())
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          `INSERT INTO household (id, doc, revision, updated_at) VALUES (1, ?, 1, ?)
           ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, revision = household.revision + 1, updated_at = excluded.updated_at`,
        )
        .run(JSON.stringify(next), now)
      this.db.prepare('INSERT INTO audit_log (at, action, detail) VALUES (?, ?, ?)').run(now, action, detail ?? null)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return next
  }

  revision(): number {
    const row = this.db.prepare('SELECT revision FROM household WHERE id = 1').get() as { revision: number } | undefined
    return row?.revision ?? 0
  }

  /** True when the database answers a query; used by /api/health. */
  ping(): boolean {
    try {
      this.db.prepare('SELECT 1').get()
      return true
    } catch {
      return false
    }
  }

  close(): void {
    this.db.close()
  }
}
