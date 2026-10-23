import http from 'node:http'
import https from 'node:https'

/**
 * One simulated PPD participant. It does what a real device does, over the same transport
 * (draft-dsmullen-ppd-protocol-04): confirm the origin with GET /.well-known/ppd, register, declare,
 * fetch its effective policy, acknowledge the exact instance, and renew at 80% of renewal_interval.
 * A 409 from the gateway (reassociation required, stale, or a mismatched instance) starts over.
 */

export interface ParticipantIdentity {
  deviceId: string
  registration: Record<string, string>
  declaration: { device_id: string; declaration_id: string; taxonomy: { release: string }; statements: object[] }
}

export interface ParticipantTls { ca?: Buffer; cert?: Buffer; key?: Buffer; servername?: string }

export type ParticipantState = 'joining' | 'associated' | 'paused' | 'error'

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const RETRY_MS = 5000
const MIN_RENEW_MS = 5000

export class Participant {
  state: ParticipantState = 'paused'
  lastEvent: string | null = null
  lastEventAt: string | null = null
  lastError: string | null = null
  private running = false
  private wake: (() => void) | null = null
  private readonly agent: http.Agent

  constructor(private readonly origin: string, private readonly identity: ParticipantIdentity, tls: ParticipantTls | null, private readonly onChange: () => void) {
    this.agent = origin.startsWith('https://') ? new https.Agent({ ...tls, keepAlive: false }) : new http.Agent({ keepAlive: false })
  }

  get active(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stops renewing, like pulling the plug. The gateway marks the device stale once its receipt ages out. */
  stop(): void {
    if (!this.running) return
    this.running = false
    this.wake?.()
    this.event('paused', 'Stopped renewing (unplugged)')
  }

  private event(state: ParticipantState, message: string, error: string | null = null): void {
    this.state = state
    this.lastEvent = message
    this.lastEventAt = new Date().toISOString()
    this.lastError = error
    this.onChange()
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        this.event('joining', 'Looking for the home gateway')
        const base = await this.discover()
        await this.request('POST', base + 'device/register', this.identity.registration)
        this.event('joining', 'Registered')
        // Describing itself is optional (protocol-04); acknowledging the household policy is not. A rejected
        // declaration is the vendor's error: carry on and still fetch and acknowledge the policy.
        try {
          await this.request('POST', base + 'device/declaration', this.identity.declaration)
          this.event('joining', `Declared ${this.identity.declaration.statements.length} data flows`)
        } catch (e) {
          if (!(e instanceof RequestError) || (e.status !== 400 && e.status !== 422)) throw e
          this.event('joining', 'Declaration rejected by the gateway; continuing without it', e.message)
        }
        while (this.running) {
          const policy = (await this.request('GET', base + 'policy/effective/' + encodeURIComponent(this.identity.deviceId))) as { policy_id: string; policy_hash: string; renewal_interval?: number }
          const ack = (await this.request('POST', base + 'device/ack', { device_id: this.identity.deviceId, policy_id: policy.policy_id, policy_hash: policy.policy_hash })) as { association_status?: string; renewal_interval?: number }
          // Unplugged while the request was in flight: stay paused.
          if (!this.running) break
          this.event('associated', `Confirmed receipt of ${policy.policy_id}`)
          const interval = (ack.renewal_interval ?? policy.renewal_interval ?? 60) * 1000
          await this.sleep(Math.max(MIN_RENEW_MS, interval * 0.8))
        }
      } catch (e) {
        if (!this.running) break
        if (e instanceof RequestError && e.status === 409) {
          this.event('joining', 'The gateway asked it to reassociate')
          continue
        }
        this.event('error', 'Could not reach the gateway; retrying', e instanceof Error ? e.message : String(e))
        await this.sleep(RETRY_MS)
      }
    }
  }

  /** GET /.well-known/ppd and check service_base_uri: same scheme, host and port, path ending in "/". */
  private async discover(): Promise<string> {
    const meta = (await this.request('GET', this.origin + '/.well-known/ppd')) as { service_base_uri?: string }
    const base = meta.service_base_uri ?? ''
    const parsed = new URL(base)
    const origin = new URL(this.origin)
    if (!base.endsWith('/') || parsed.protocol !== origin.protocol) throw new Error(`Invalid service_base_uri ${base}`)
    // The gateway builds the base from the Host it was asked for; resolve against our own origin so an
    // internal Docker hostname keeps working.
    return this.origin + parsed.pathname
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      this.wake = done
    })
  }

  private request(method: string, url: string, body?: unknown): Promise<unknown> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(payload.length)
    }
    const transport = url.startsWith('https://') ? https : http
    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method, headers, agent: this.agent, timeout: 5000 }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          let data: unknown = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = text
          }
          if (status >= 200 && status < 300) return resolve(data)
          const problem = data && typeof data === 'object' ? (data as { title?: string; detail?: string }) : null
          reject(new RequestError(`${method} ${new URL(url).pathname} → ${status}${problem?.detail ? ': ' + problem.detail : ''}`, status))
        })
      })
      req.on('timeout', () => req.destroy(new Error('the gateway did not answer in time')))
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }
}
