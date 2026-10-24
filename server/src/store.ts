import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { normalizeHousehold } from '../../shared/household'
import type { Command, CommandAction, Household, Policy, TelemetrySample } from '../../shared/types'

/**
 * app-api's SQLite store. The household (one demo household) is a single document with a revision
 * counter. Alongside it: an audit log of every change, the household policies the app published, which
 * gateway devices have been seen, the guided-demo command queue and demo telemetry. The published policy
 * itself lives in the PPD preference repository; app-api only records what it sent.
 * Node's built-in SQLite is synchronous, so each update runs without another request in between.
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
        detail TEXT,
        actor TEXT
      );
      CREATE TABLE IF NOT EXISTS live_device (
        device_id TEXT PRIMARY KEY,
        registered_at TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS publication (
        policy_id TEXT PRIMARY KEY,
        household_revision INTEGER NOT NULL,
        policy TEXT NOT NULL,
        rules INTEGER NOT NULL,
        published_by TEXT NOT NULL,
        published_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        action TEXT NOT NULL,
        value TEXT,
        status TEXT NOT NULL,
        detail TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        delivered_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS command_device ON command (device_id, created_at);
      CREATE TABLE IF NOT EXISTS telemetry_sample (
        device_id TEXT NOT NULL,
        sample_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        temperature_c REAL,
        humidity_pct REAL,
        reported_policy_id TEXT,
        behavior_mode TEXT,
        received_at TEXT NOT NULL,
        PRIMARY KEY (device_id, sample_id)
      );
      CREATE INDEX IF NOT EXISTS telemetry_recent ON telemetry_sample (device_id, received_at);
      CREATE TABLE IF NOT EXISTS sim_device (
        device_id TEXT PRIMARY KEY,
        wanted TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    // Older databases predate the actor column.
    const columns = this.db.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[]
    if (!columns.some((c) => c.name === 'actor')) this.db.exec('ALTER TABLE audit_log ADD COLUMN actor TEXT')
  }

  /* ---------- household ---------- */

  /** The stored household, or null before the first write. */
  get(): Household | null {
    const row = this.db.prepare('SELECT doc FROM household WHERE id = 1').get() as { doc: string } | undefined
    // Older documents may lack newer fields; fill them in.
    return row ? normalizeHousehold(JSON.parse(row.doc)) : null
  }

  /** Applies `change` to the current household (or `initial()` if there is none yet) and stores the result. */
  update(action: string, initial: () => Household, change: (h: Household) => Household, detail?: string, actor?: string): Household {
    return this.transaction(() => {
      const next = change(this.get() ?? initial())
      const now = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO household (id, doc, revision, updated_at) VALUES (1, ?, 1, ?)
           ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, revision = household.revision + 1, updated_at = excluded.updated_at`,
        )
        .run(JSON.stringify(next), now)
      this.audit(action, detail, actor)
      return next
    })
  }

  revision(): number {
    const row = this.db.prepare('SELECT revision FROM household WHERE id = 1').get() as { revision: number } | undefined
    return row?.revision ?? 0
  }

  audit(action: string, detail?: string, actor?: string): void {
    this.db.prepare('INSERT INTO audit_log (at, action, detail, actor) VALUES (?, ?, ?, ?)').run(new Date().toISOString(), action, detail ?? null, actor ?? null)
  }

  /* ---------- gateway devices seen ---------- */

  /** The registration time we last saw for a gateway device, or null if it is new to the household. */
  liveSeen(deviceId: string): string | null {
    const row = this.db.prepare('SELECT registered_at FROM live_device WHERE device_id = ?').get(deviceId) as { registered_at: string } | undefined
    return row?.registered_at ?? null
  }

  markLiveSeen(deviceId: string, registeredAt: string): void {
    this.db
      .prepare('INSERT INTO live_device (device_id, registered_at, first_seen_at) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET registered_at = excluded.registered_at')
      .run(deviceId, registeredAt, new Date().toISOString())
  }

  /* ---------- publications ---------- */

  recordPublication(policy: Policy, householdRevision: number, by: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO publication (policy_id, household_revision, policy, rules, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(policy.policy_id, householdRevision, JSON.stringify(policy), policy.rules.length, by, new Date().toISOString())
    this.audit('publish', `${policy.policy_id} · ${policy.rules.length} rules`, by)
  }

  /** True when the app published this policy instance (rather than a preset or another writer). */
  publishedByApp(policyId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM publication WHERE policy_id = ?').get(policyId)
  }

  /* ---------- guided-demo commands ---------- */

  createCommand(deviceId: string, action: CommandAction, value: string | null, by: string, ttlMs = 2 * 60_000): Command {
    const now = new Date()
    const cmd: Command = { id: randomUUID(), device_id: deviceId, action, value, status: 'queued', detail: null, created_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString() }
    this.db
      .prepare('INSERT INTO command (id, device_id, action, value, status, detail, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)')
      .run(cmd.id, deviceId, action, value, cmd.status, by, cmd.created_at, cmd.expires_at)
    this.audit('command', `${deviceId} ${action}${value ? ' ' + value : ''}`, by)
    return cmd
  }

  private expireCommands(): void {
    this.db.prepare(`UPDATE command SET status = 'expired', finished_at = ? WHERE status IN ('queued', 'delivered') AND expires_at < ?`).run(new Date().toISOString(), new Date().toISOString())
  }

  listCommands(deviceId: string, limit = 10): Command[] {
    this.expireCommands()
    return this.db
      .prepare('SELECT id, device_id, action, value, status, detail, created_at, expires_at FROM command WHERE device_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(deviceId, limit) as unknown as Command[]
  }

  /** Commands the device should run now. A delivered command is offered again until the device reports a result. */
  pendingCommands(deviceId: string): Command[] {
    return this.transaction(() => {
      this.expireCommands()
      const rows = this.db
        .prepare(`SELECT id, device_id, action, value, status, detail, created_at, expires_at FROM command WHERE device_id = ? AND status IN ('queued', 'delivered') ORDER BY created_at`)
        .all(deviceId) as unknown as Command[]
      this.db.prepare(`UPDATE command SET status = 'delivered', delivered_at = COALESCE(delivered_at, ?) WHERE device_id = ? AND status = 'queued'`).run(new Date().toISOString(), deviceId)
      return rows
    })
  }

  /** Records the device's result. Returns false for an unknown command. Repeated results are harmless. */
  commandResult(deviceId: string, id: string, status: 'completed' | 'skipped' | 'failed', detail: string): boolean {
    const res = this.db
      .prepare(`UPDATE command SET status = ?, detail = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ? AND device_id = ? AND status IN ('queued', 'delivered', 'completed', 'skipped', 'failed')`)
      .run(status, detail, new Date().toISOString(), id, deviceId)
    return Number(res.changes) > 0
  }

  /* ---------- demo telemetry ---------- */

  /** Stores one sample; a retried upload with the same sample_id is ignored. Keeps the newest 2000 per device. */
  addTelemetry(deviceId: string, s: Omit<TelemetrySample, 'received_at'>): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO telemetry_sample (device_id, sample_id, purpose, temperature_c, humidity_pct, reported_policy_id, behavior_mode, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(deviceId, s.sample_id, s.purpose, s.temperature_c, s.humidity_pct, s.reported_policy_id, s.behavior_mode, new Date().toISOString())
    this.db
      .prepare('DELETE FROM telemetry_sample WHERE device_id = ? AND sample_id NOT IN (SELECT sample_id FROM telemetry_sample WHERE device_id = ? ORDER BY received_at DESC LIMIT 2000)')
      .run(deviceId, deviceId)
    return Number(res.changes) > 0
  }

  telemetry(deviceId: string, limit = 60): TelemetrySample[] {
    return this.db
      .prepare('SELECT sample_id, purpose, temperature_c, humidity_pct, reported_policy_id, behavior_mode, received_at FROM telemetry_sample WHERE device_id = ? ORDER BY received_at DESC LIMIT ?')
      .all(deviceId, limit) as unknown as TelemetrySample[]
  }

  telemetryByPurpose(deviceId: string): { purpose: string; count: number; last_at: string | null }[] {
    return this.db
      .prepare('SELECT purpose, COUNT(*) AS count, MAX(received_at) AS last_at FROM telemetry_sample WHERE device_id = ? GROUP BY purpose ORDER BY purpose')
      .all(deviceId) as unknown as { purpose: string; count: number; last_at: string | null }[]
  }

  /* ---------- demo simulator ---------- */

  /** What the presenter last asked each simulated device to do, so a restart restores it. */
  simWanted(): Map<string, string> {
    const rows = this.db.prepare('SELECT device_id, wanted FROM sim_device').all() as { device_id: string; wanted: string }[]
    return new Map(rows.map((r) => [r.device_id, r.wanted]))
  }

  setSimWanted(deviceId: string, wanted: string): void {
    this.db
      .prepare('INSERT INTO sim_device (device_id, wanted, updated_at) VALUES (?, ?, ?) ON CONFLICT(device_id) DO UPDATE SET wanted = excluded.wanted, updated_at = excluded.updated_at')
      .run(deviceId, wanted, new Date().toISOString())
  }

  /* ---------- plumbing ---------- */

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
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
