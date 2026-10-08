import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, afterEach, beforeEach } from "vitest"

type TestDb = { url: string; appUrl: string; name: string }

const DISCONNECT_SQL =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()"

let admin: Client | null = null
let current: TestDb | null = null

const templates = (): string[] =>
  (process.env.FORGE_SEED_TEMPLATES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

const workerIndex = (): number => {
  const parsed = Number(process.env.STRYKER_MUTATOR_WORKER ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0
}

const workerTemplate = (): string => {
  const names = templates()
  const name = names[workerIndex() % names.length]
  if (name === undefined) throw new Error("no seed template for this worker")
  return name
}

const baseOf = (url: string): string => url.slice(0, url.lastIndexOf("/"))

const superUrl = (): string => {
  const url = process.env.__TEST_DB_URL__
  if (!url) throw new Error("__TEST_DB_URL__ is not set, so the harness is not attached")
  return url
}

const closeAdmin = async (): Promise<void> => {
  const client = admin
  admin = null
  if (client !== null) await client.end().catch(() => undefined)
}

const adminQuery = async (sql: string, params: string[] = []): Promise<void> => {
  try {
    if (admin === null) {
      const client = new Client({ connectionString: baseOf(superUrl()) + "/postgres" })
      await client.connect()
      admin = client
    }
    await admin.query(sql, params)
  } catch (error) {
    await closeAdmin()
    throw error
  }
}

const createTestDb = async (): Promise<TestDb> => {
  const base = baseOf(superUrl())
  const appBase = process.env.__TEST_APP_DB_URL__
  const name = "t_" + workerIndex() + "_" + randomUUID().slice(0, 8)
  await adminQuery('CREATE DATABASE "' + name + '" TEMPLATE "' + workerTemplate() + '"')
  return {
    url: base + "/" + name,
    appUrl: (appBase ? baseOf(appBase) : base) + "/" + name,
    name,
  }
}

const dropTestDb = async (name: string): Promise<void> => {
  await adminQuery(DISCONNECT_SQL, [name])
  await adminQuery('DROP DATABASE IF EXISTS "' + name + '"')
}

beforeEach(async () => {
  current = await createTestDb()
  process.env.__TEST_DB_URL__ = current.url
  process.env.__TEST_APP_DB_URL__ = current.appUrl
  process.env.DATABASE_URL = current.appUrl
}, 60_000)

afterEach(async () => {
  const created = current
  current = null
  if (created === null) return
  try {
    await dropTestDb(created.name)
  } catch (error) {
    console.warn("could not drop " + created.name, error)
  }
}, 60_000)

afterAll(closeAdmin)
