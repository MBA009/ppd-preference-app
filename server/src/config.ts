import { fileURLToPath } from 'node:url'

/** Runtime settings, all from environment variables. Paths default to the repository layout so `npm run dev` works with no setup. */
export interface Config {
  port: number
  host: string
  databasePath: string
  /** The research fixtures (public/mock/): questionnaire, device library, device declarations, privacy codes. */
  fixturesDir: string
  /** The PPD gateway, reached from app-api only. The browser never calls it. */
  gatewayUrl: string
  logLevel: string
}

// src/config.ts and the bundled dist/index.js are both two levels below the repository root.
const repoPath = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databasePath: env.DATABASE_PATH ?? repoPath('server/data/app.db'),
    fixturesDir: env.FIXTURES_DIR ?? repoPath('public/mock'),
    gatewayUrl: (env.GATEWAY_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    logLevel: env.LOG_LEVEL ?? 'info',
  }
}
