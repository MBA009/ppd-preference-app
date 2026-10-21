import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto'
import type { Me } from '../../shared/types'
import type { Config } from './config'

/**
 * Who is calling. In production every /api request must carry a Cloudflare Access application token
 * (the Cf-Access-Jwt-Assertion header, or the CF_Authorization cookie); app-api checks its signature,
 * issuer, audience and expiry itself rather than trusting an email header. Missing or invalid tokens
 * fail closed. In development a fixed local operator is used.
 */
export type Identity = Me

interface Jwks { keys: (JsonWebKey & { kid?: string })[] }

export class Authenticator {
  private keys = new Map<string, KeyObject>()
  private fetchedAt = 0

  constructor(private readonly config: Config) {}

  async identify(headers: Record<string, string | string[] | undefined>): Promise<Identity | null> {
    if (this.config.appEnv === 'development') return { email: 'developer@localhost', role: 'operator' }
    const token = header(headers, 'cf-access-jwt-assertion') ?? cookie(header(headers, 'cookie'), 'CF_Authorization')
    if (!token) return null
    const email = await this.verifyAccessToken(token)
    return email ? { email, role: this.roleFor(email) } : null
  }

  private roleFor(email: string): Me['role'] {
    const operators = this.config.auth.operatorEmails
    return operators.length === 0 || operators.includes(email.toLowerCase()) ? 'operator' : 'viewer'
  }

  /** Returns the token's email when the token is valid for this application, otherwise null. */
  async verifyAccessToken(token: string): Promise<string | null> {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [rawHeader, rawPayload, rawSignature] = parts
    let head: { alg?: string; kid?: string }
    let claims: { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string }
    try {
      head = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8'))
      claims = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'))
    } catch {
      return null
    }
    if (head.alg !== 'RS256' || !head.kid) return null
    const key = await this.key(head.kid)
    if (!key) return null
    const signed = verify('RSA-SHA256', Buffer.from(`${rawHeader}.${rawPayload}`), key, Buffer.from(rawSignature, 'base64url'))
    if (!signed) return null

    const now = Math.floor(Date.now() / 1000)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(this.config.auth.audience)) return null
    if (claims.iss !== `https://${this.config.auth.teamDomain}`) return null
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null
    return typeof claims.email === 'string' && claims.email ? claims.email : null
  }

  private async key(kid: string): Promise<KeyObject | undefined> {
    // Refresh the signing keys at most every 10 minutes, or when an unknown key id appears.
    if (!this.keys.has(kid) || Date.now() - this.fetchedAt > 10 * 60_000) {
      try {
        const res = await fetch(`https://${this.config.auth.teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) })
        const jwks = (await res.json()) as Jwks
        this.keys = new Map(jwks.keys.filter((k) => k.kid).map((k) => [k.kid!, createPublicKey({ key: k, format: 'jwk' })]))
        this.fetchedAt = Date.now()
      } catch {
        // Keep the keys we have; an unknown kid then fails closed.
      }
    }
    return this.keys.get(kid)
  }
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name]
  return Array.isArray(v) ? v[0] : v
}

function cookie(raw: string | undefined, name: string): string | undefined {
  for (const part of (raw ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}
