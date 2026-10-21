import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Runtime settings, all from environment variables. Paths default to the repository layout so `npm run dev` works with no setup. */
export interface Config {
  port: number
  host: string
  /** development enables a fixed local identity; anything else requires Cloudflare Access. */
  appEnv: 'development' | 'production'
  databasePath: string
  /** The research fixtures (public/mock/): questionnaire, device library, declarations, privacy codes. */
  fixturesDir: string
  /** Which gateway devices are real hardware or simulated participants, and how to present them. */
  deviceRegistryPath: string
  gateway: GatewayConfig
  /** Shared secret the gateway presents on /internal/* (its PPD_DEMO_APP_API_TOKEN). */
  internalServiceToken: string
  auth: { teamDomain: string; audience: string; operatorEmails: string[] }
  /** Show the gateway's router-only checks (DHCP, ARP, Wi-Fi) on System status. Off for the cloud gateway. */
  routerChecks: boolean
  logLevel: string
}

export interface GatewayConfig {
  /** The PPD service origin, e.g. https://gateway:8080 inside Compose. The browser never calls it. */
  url: string
  /** Sent as Authorization: Bearer on operator routes (the gateway's PPD_OPERATOR_TOKEN). */
  operatorToken: string
  /** TLS server name to verify when `url` uses an internal hostname, e.g. devices.example.com. */
  tlsServerName: string
  caFile: string
  clientCertFile: string
  clientKeyFile: string
  timeoutMs: number
}

// src/config.ts and the bundled dist/index.js are both two levels below the repository root.
const repoPath = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))

/** Reads a secret from VAR, or from the file named by VAR_FILE (Docker/Coolify secrets). */
function secret(env: NodeJS.ProcessEnv, name: string): string {
  const file = env[`${name}_FILE`]
  if (file) return readFileSync(file, 'utf8').trim()
  return (env[name] ?? '').trim()
}

const list = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    appEnv: env.APP_ENV === 'production' ? 'production' : 'development',
    databasePath: env.DATABASE_PATH ?? repoPath('server/data/app.db'),
    fixturesDir: env.FIXTURES_DIR ?? repoPath('public/mock'),
    deviceRegistryPath: env.DEVICE_REGISTRY ?? repoPath('server/config/devices.json'),
    gateway: {
      url: (env.GATEWAY_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, ''),
      operatorToken: secret(env, 'GATEWAY_OPERATOR_TOKEN'),
      tlsServerName: env.GATEWAY_TLS_SERVER_NAME ?? '',
      caFile: env.GATEWAY_CA_FILE ?? '',
      clientCertFile: env.GATEWAY_CLIENT_CERT_FILE ?? '',
      clientKeyFile: env.GATEWAY_CLIENT_KEY_FILE ?? '',
      timeoutMs: Number(env.GATEWAY_TIMEOUT_MS ?? 4000),
    },
    internalServiceToken: secret(env, 'INTERNAL_SERVICE_TOKEN'),
    auth: { teamDomain: (env.CF_ACCESS_TEAM_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, ''), audience: env.CF_ACCESS_AUD ?? '', operatorEmails: list(env.OPERATOR_EMAILS) },
    routerChecks: env.ROUTER_CHECKS === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
  }
}

/** Refuses to start production without a login method: the household API must never be open. */
export function assertDeployable(config: Config): void {
  if (config.appEnv === 'production' && (!config.auth.teamDomain || !config.auth.audience)) {
    throw new Error('APP_ENV=production needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (Cloudflare Access).')
  }
  if (config.appEnv === 'production' && !config.internalServiceToken) {
    throw new Error('APP_ENV=production needs INTERNAL_SERVICE_TOKEN for gateway callbacks.')
  }
}
