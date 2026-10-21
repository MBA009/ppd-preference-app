import { buildApp } from './app'
import { assertDeployable, loadConfig } from './config'
import { loadFixtures } from './fixtures'
import { HouseholdStore } from './store'

const config = loadConfig()
assertDeployable(config)
const fixtures = await loadFixtures(config.fixturesDir)
const store = new HouseholdStore(config.databasePath)
const app = buildApp(config, fixtures, store)

const shutdown = async () => {
  await app.close()
  store.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await app.listen({ port: config.port, host: config.host })
app.log.info({ env: config.appEnv, database: config.databasePath, fixtures: config.fixturesDir, gateway: config.gateway.url }, 'app-api ready')
