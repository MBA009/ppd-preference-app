import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { Policy } from '../../shared/types'
import type { GatewayConfig } from './config'

/**
 * app-api's client for the PPD gateway. It discovers the API through GET /.well-known/ppd and resolves
 * every operation against the advertised service_base_uri (draft-dsmullen-ppd-protocol-04 section 4.4),
 * sends the operator bearer token, and uses mutual TLS when certificate files are configured.
 * Operator routes (status, policy, presets, previews, disassociation) are gateway extensions, not -04
 * participant operations.
 */

export class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly problemType: string | null = null) {
    super(message)
  }
}

export interface GatewayHealth { url: string; reachable: boolean; status: number | null; error: string | null }

/** The gateway's per-device dashboard view (GET status/devices). Only the fields app-api uses are typed. */
export interface GatewayDevice {
  device_id: string
  manufacturer?: string
  model?: string
  firmware_version?: string
  registered: boolean
  registered_at?: string
  declared: boolean
  declaration_id?: string
  declared_at?: string
  declaration_statements?: { statement_id: string; data_type: string; purpose: string; action: string; source: string; handling_context: string; constraints?: Record<string, unknown> }[]
  policy_retrieved: boolean
  acknowledged: boolean
  associated: boolean
  association_status: string
  required_lifecycle_step?: string
  association_reasons?: string[]
  next_step_summary?: string
  attention_reason?: string
  association_explanation?: string
  policy_source_label?: string
  list_group?: string
  sort_priority?: number
  association_badge?: { label: string; tone: string }
  policy_badge?: { label: string; tone: string }
  acknowledgement_badge?: { label: string; tone: string }
  network_badge?: { label: string; tone: string }
  auth_badge?: { label: string; tone: string }
  list_badges?: { label: string; tone: string }[]
  last_association_renewed_at?: string
  association_fresh_until?: string
  association_freshness_interval?: string
  effective_policy_id?: string
  ack_policy_id?: string
  ack_policy_hash?: string
  base_policy_id?: string
  applied_policy_id?: string
  policy_hash?: string
  conflict_active?: boolean
  behavior_mode?: string
  conflicting_purposes?: string[]
  auth_method?: string
  cert_fingerprint?: string
  mac_address?: string
  ip_address?: string
  hostname?: string
  network_observed?: boolean
  /** False for devices the router sees but that never registered with PPD (unmanaged). */
  known_to_gateway?: boolean
  network_identifier?: string
  likely_device_type?: string
  likely_device_vendor?: string
  last_network_observed_at?: string
  last_policy_retrieved?: string
  last_acknowledged_at?: string
}

export interface GatewaySummary {
  default_policy_id?: string
  default_policy_updated_at?: string
  association_freshness_interval?: string
  tls_enabled?: boolean
  mutual_tls_required?: boolean
  known_devices?: number
  registered_devices?: number
  declared_devices?: number
  policy_retrieved_devices?: number
  acknowledged_devices?: number
  associated_devices?: number
  needs_reassociation_devices?: number
  policy_conflict_devices?: number
  stale_association_devices?: number
  broken_association_devices?: number
  override_devices?: number
  authenticated_devices?: number
  compatibility_mode_devices?: number
  network_observed_devices?: number
  unmanaged_devices?: number
}

export interface GatewayCheck { check_id: string; name: string; category: string; status: 'pass' | 'warn' | 'fail'; detail: string }
/** One entry of GET policy/examples: a summary, not the policy itself. */
export interface GatewayExample { name: string; title: string; summary: string; policy_id: string; rule_count: number }
export interface ServiceMetadata { service_base_uri: string; security_profile: string; protocol_version: string }

export class GatewayClient {
  private base: string | null = null
  private metadata: ServiceMetadata | null = null
  private readonly agent: http.Agent | https.Agent

  constructor(private readonly config: GatewayConfig) {
    const tls = config.url.startsWith('https://')
    const read = (f: string) => (f ? readFileSync(f) : undefined)
    this.agent = tls
      ? new https.Agent({ keepAlive: true, ca: read(config.caFile), cert: read(config.clientCertFile), key: read(config.clientKeyFile), servername: config.tlsServerName || undefined })
      : new http.Agent({ keepAlive: true })
  }

  get origin(): string {
    return this.config.url
  }

  /** The API base URI, discovered once from /.well-known/ppd. Falls back to the -03 /ppd/v1/ layout. */
  async baseUri(): Promise<string> {
    if (this.base) return this.base
    try {
      const meta = (await this.raw('GET', `${this.config.url}/.well-known/ppd`)).data as ServiceMetadata
      const base = new URL(meta.service_base_uri)
      if (!meta.service_base_uri.endsWith('/') || base.protocol !== new URL(this.config.url).protocol) throw new GatewayError('Invalid service_base_uri', 502)
      // The gateway builds the base from the Host it was asked for; keep app-api's own origin so an
      // internal Docker hostname still works.
      this.base = `${this.config.url}${base.pathname}`
      this.metadata = meta
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) this.base = `${this.config.url}/ppd/v1/`
      else throw e
    }
    return this.base
  }

  async serviceMetadata(): Promise<ServiceMetadata | null> {
    await this.baseUri()
    return this.metadata
  }

  async health(): Promise<GatewayHealth> {
    try {
      await this.call('GET', 'health')
      return { url: this.config.url, reachable: true, status: 200, error: null }
    } catch (e) {
      const status = e instanceof GatewayError && e.status > 0 ? e.status : null
      return { url: this.config.url, reachable: false, status, error: e instanceof Error ? e.message : 'unknown error' }
    }
  }

  summary = () => this.call<GatewaySummary>('GET', 'status/summary')
  devices = () => this.call<GatewayDevice[]>('GET', 'status/devices')
  async checks(): Promise<GatewayCheck[]> {
    return (await this.call<{ checks: GatewayCheck[] }>('GET', 'service-health/checks')).checks ?? []
  }
  async defaultPolicy(): Promise<Policy | null> {
    try {
      return await this.call<Policy>('GET', 'policy/default')
    } catch (e) {
      if (e instanceof GatewayError && e.status === 404) return null
      throw e
    }
  }
  putDefaultPolicy = (p: Policy) => this.call<unknown>('PUT', 'policy/default', p)
  examples = () => this.call<GatewayExample[]>('GET', 'policy/examples')
  applyExample = (name: string) => this.call<{ policy_id: string }>('POST', `policy/default/example/${encodeURIComponent(name)}`)
  effectivePreview = (deviceId: string) => this.call<Policy & { policy_hash: string }>('GET', `policy/effective-preview/${encodeURIComponent(deviceId)}`)
  disassociate = (deviceId: string, reason: string) => this.call<unknown>('POST', `device/disassociate/${encodeURIComponent(deviceId)}`, { reason })
  /** Deletes a device that has left the home (our gateway fork's operator extension). 409 while associated or on the network. */
  forget = (deviceId: string) => this.call<unknown>('POST', `device/forget/${encodeURIComponent(deviceId)}`)

  /** Calls a reference relative to service_base_uri with the operator token. */
  async call<T>(method: string, reference: string, body?: unknown): Promise<T> {
    const url = new URL(reference, await this.baseUri()).toString()
    return (await this.raw(method, url, body)).data as T
  }

  private raw(method: string, url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.config.operatorToken) headers.Authorization = `Bearer ${this.config.operatorToken}`
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(payload.length)
    }
    const transport = url.startsWith('https://') ? https : http
    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method, headers, agent: this.agent, timeout: this.config.timeoutMs }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data: unknown = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = text
          }
          const status = res.statusCode ?? 0
          if (status >= 200 && status < 300) return resolve({ status, data })
          const problem = data && typeof data === 'object' ? (data as { title?: string; detail?: string; type?: string }) : null
          const message = problem?.detail || problem?.title || (typeof data === 'string' && data.trim()) || `HTTP ${status}`
          reject(new GatewayError(`Gateway ${method} ${new URL(url).pathname}: ${message}`, status, problem?.type ?? null))
        })
      })
      req.on('timeout', () => req.destroy(new GatewayError(`Gateway did not answer within ${this.config.timeoutMs} ms`, 0)))
      req.on('error', (e) => reject(e instanceof GatewayError ? e : new GatewayError(`Gateway unreachable: ${e.message}`, 0)))
      if (payload) req.write(payload)
      req.end()
    })
  }
}
