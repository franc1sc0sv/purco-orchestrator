import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { Client } from "pg"

import projectGlobalSetup from "__GLOBAL_SETUP__"

const CONFIG = __CONFIG__

const DISCONNECT_SQL =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()"

const adminUrl = (): string => {
  const url = process.env.__TEST_DB_URL__
  if (!url) throw new Error("the project global setup produced no __TEST_DB_URL__")
  return url.slice(0, url.lastIndexOf("/")) + "/postgres"
}

const onAdmin = async (work: (client: Client) => Promise<void>): Promise<void> => {
  const client = new Client({ connectionString: adminUrl() })
  await client.connect()
  try {
    await work(client)
  } finally {
    await client.end()
  }
}

const tunePostgres = (): Promise<void> =>
  onAdmin(async (client) => {
    for (const [key, value] of Object.entries(CONFIG.fastPostgres)) {
      await client.query(`ALTER SYSTEM SET ${key} = '${value}'`)
    }
    await client.query("SELECT pg_reload_conf()")
    await new Promise((settle) => setTimeout(settle, 1000))
  })

const buildTemplates = (): Promise<void> =>
  onAdmin(async (client) => {
    await client.query(DISCONNECT_SQL, [CONFIG.seedDbName])
    for (const name of CONFIG.templates) {
      await client.query(DISCONNECT_SQL, [name])
      await client.query(`DROP DATABASE IF EXISTS "${name}"`)
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${CONFIG.seedDbName}"`)
    }
  })

const dropTemplates = (): Promise<void> =>
  onAdmin(async (client) => {
    for (const name of CONFIG.templates) {
      await client.query(DISCONNECT_SQL, [name])
      await client.query(`DROP DATABASE IF EXISTS "${name}"`)
    }
  })

export default async function forgeStrykerBoot() {
  const startedAt = Date.now()
  const before = { ...process.env }
  const teardown = await projectGlobalSetup()
  const globalSetupDoneAt = Date.now()
  const release = async () => {
    if (typeof teardown === "function") await teardown()
  }
  try {
    await tunePostgres()
    await buildTemplates()
  } catch (error) {
    await release()
    throw error
  }
  const templatesDoneAt = Date.now()
  const carried: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && before[key] !== value) {
      carried[key] = value
    }
  }
  mkdirSync(dirname(CONFIG.manifestPath), { recursive: true })
  writeFileSync(
    CONFIG.manifestPath,
    JSON.stringify(
      {
        ready: true,
        pid: process.pid,
        startedAt,
        globalSetupMs: globalSetupDoneAt - startedAt,
        templatesMs: templatesDoneAt - globalSetupDoneAt,
        totalMs: templatesDoneAt - startedAt,
        templates: CONFIG.templates,
        env: carried,
      },
      null,
      2
    )
  )
  return async () => {
    await dropTemplates().catch(() => undefined)
    await release()
  }
}
