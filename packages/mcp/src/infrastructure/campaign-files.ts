import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEED_TEMPLATE_ENV } from "test-forge-contracts/campaign";

export const SCAFFOLD_DIRECTORY = ".test-forge";

export const BOOT_CONFIG_FILE = `${SCAFFOLD_DIRECTORY}/campaign-boot.config.mts`;

export const LANE_CONFIG_FILE = `${SCAFFOLD_DIRECTORY}/lane.config.mts`;

const BOOT_SETUP_FILE = `${SCAFFOLD_DIRECTORY}/campaign-boot-setup.ts`;

const HOLD_TEST_FILE = `${SCAFFOLD_DIRECTORY}/campaign-hold.test.ts`;

const ATTACH_SETUP_FILE = `${SCAFFOLD_DIRECTORY}/attach-setup.ts`;

const LANE_DB_SETUP_FILE = `${SCAFFOLD_DIRECTORY}/lane-db-per-test.ts`;

const DISCONNECT_SQL =
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()";

const TYPESCRIPT_EXTENSION = /\.(?:m|c)?tsx?$/;

const toPosix = (path: string): string => path.split(sep).join("/");

const specifierFrom = (fromDirectory: string, target: string): string => {
  const relativePath = toPosix(
    relative(toPosix(fromDirectory), toPosix(target))
  );
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

const moduleSpecifier = (fromDirectory: string, target: string): string =>
  specifierFrom(fromDirectory, target).replace(TYPESCRIPT_EXTENSION, "");

const write = (worktree: string, file: string, body: string): string => {
  const absolute = join(worktree, ...file.split("/"));
  mkdirSync(join(worktree, SCAFFOLD_DIRECTORY), { recursive: true });
  writeFileSync(absolute, body);
  return absolute;
};

const quoted = (value: string): string => JSON.stringify(value);

export type BootScaffoldInput = {
  worktree: string;
  projectConfigFile: string;
  globalSetupFile: string;
  manifestPath: string;
  stopFilePath: string;
  cacheDir: string;
  holdTimeoutMs: number;
  bootTimeoutMs: number;
  seedDbName: string;
  templates: readonly string[];
};

export const writeBootScaffold = ({
  worktree,
  projectConfigFile,
  globalSetupFile,
  manifestPath,
  stopFilePath,
  cacheDir,
  holdTimeoutMs,
  bootTimeoutMs,
  seedDbName,
  templates,
}: BootScaffoldInput): { configFile: string } => {
  const setupBody = [
    `import { mkdirSync, writeFileSync } from "node:fs"`,
    `import { dirname } from "node:path"`,
    `import { Client } from "pg"`,
    ``,
    `import projectGlobalSetup from ${quoted(
      moduleSpecifier(SCAFFOLD_DIRECTORY, globalSetupFile)
    )}`,
    ``,
    `const MANIFEST_PATH = ${quoted(manifestPath)}`,
    `const SEED_DB_NAME = ${quoted(seedDbName)}`,
    `const TEMPLATES = ${JSON.stringify(templates)}`,
    ``,
    `const adminUrl = (): string => {`,
    `  const url = process.env.__TEST_DB_URL__`,
    `  if (!url) {`,
    `    throw new Error(`,
    `      "the project global setup produced no __TEST_DB_URL__, so the per worker seed templates cannot be built"`,
    `    )`,
    `  }`,
    `  return url.slice(0, url.lastIndexOf("/")) + "/postgres"`,
    `}`,
    ``,
    `const onAdmin = async (work: (client: Client) => Promise<void>): Promise<void> => {`,
    `  const client = new Client({ connectionString: adminUrl() })`,
    `  await client.connect()`,
    `  try {`,
    `    await work(client)`,
    `  } finally {`,
    `    await client.end()`,
    `  }`,
    `}`,
    ``,
    `const disconnect = async (client: Client, database: string): Promise<void> => {`,
    `  await client.query(${quoted(DISCONNECT_SQL)}, [database])`,
    `}`,
    ``,
    `const buildTemplates = (): Promise<void> =>`,
    `  onAdmin(async (client) => {`,
    `    await disconnect(client, SEED_DB_NAME)`,
    `    for (const name of TEMPLATES) {`,
    `      await disconnect(client, name)`,
    `      await client.query('DROP DATABASE IF EXISTS "' + name + '"')`,
    `      await client.query(`,
    `        'CREATE DATABASE "' + name + '" TEMPLATE "' + SEED_DB_NAME + '"'`,
    `      )`,
    `    }`,
    `  })`,
    ``,
    `const dropTemplates = (): Promise<void> =>`,
    `  onAdmin(async (client) => {`,
    `    for (const name of TEMPLATES) {`,
    `      await disconnect(client, name)`,
    `      await client.query('DROP DATABASE IF EXISTS "' + name + '"')`,
    `    }`,
    `  })`,
    ``,
    `export default async function forgeCampaignBoot() {`,
    `  const before = { ...process.env }`,
    `  const teardown = await projectGlobalSetup()`,
    `  const release = async () => {`,
    `    if (typeof teardown === "function") await teardown()`,
    `  }`,
    `  try {`,
    `    await buildTemplates()`,
    `  } catch (error) {`,
    `    await release()`,
    `    throw error`,
    `  }`,
    `  const carried: Record<string, string> = {}`,
    `  for (const [key, value] of Object.entries(process.env)) {`,
    `    if (typeof value === "string" && before[key] !== value) {`,
    `      carried[key] = value`,
    `    }`,
    `  }`,
    `  mkdirSync(dirname(MANIFEST_PATH), { recursive: true })`,
    `  writeFileSync(`,
    `    MANIFEST_PATH,`,
    `    JSON.stringify(`,
    `      { ready: true, pid: process.pid, startedAt: new Date().toISOString(), env: carried },`,
    `      null,`,
    `      2`,
    `    )`,
    `  )`,
    `  return async () => {`,
    `    await dropTemplates()`,
    `    await release()`,
    `  }`,
    `}`,
    ``,
  ].join("\n");

  const holdBody = [
    `import { existsSync } from "node:fs"`,
    `import { it } from "vitest"`,
    ``,
    `const STOP_FILE = ${quoted(stopFilePath)}`,
    ``,
    `it(`,
    `  "holds the campaign environment open",`,
    `  async () => {`,
    `    while (!existsSync(STOP_FILE)) {`,
    `      await new Promise((settle) => setTimeout(settle, 500))`,
    `    }`,
    `  },`,
    `  ${holdTimeoutMs}`,
    `)`,
    ``,
  ].join("\n");

  const configBody = [
    `import tsconfigPaths from "vite-tsconfig-paths"`,
    `import { defineConfig } from "vitest/config"`,
    ``,
    `import baseConfig from ${quoted(
      specifierFrom(SCAFFOLD_DIRECTORY, projectConfigFile)
    )}`,
    ``,
    `const baseTest = baseConfig.test ?? {}`,
    ``,
    `export default defineConfig({`,
    `  root: ${quoted(worktree)},`,
    `  cacheDir: ${quoted(cacheDir)},`,
    `  plugins: [tsconfigPaths()],`,
    `  test: {`,
    `    env: baseTest.env,`,
    `    globalSetup: [${quoted(`./${BOOT_SETUP_FILE}`)}],`,
    `    include: [${quoted(HOLD_TEST_FILE)}],`,
    `    exclude: [],`,
    `    environment: "node",`,
    `    pool: "forks",`,
    `    fileParallelism: false,`,
    `    testTimeout: ${holdTimeoutMs},`,
    `    hookTimeout: ${bootTimeoutMs},`,
    `    teardownTimeout: ${bootTimeoutMs},`,
    `  },`,
    `})`,
    ``,
  ].join("\n");

  write(worktree, BOOT_SETUP_FILE, setupBody);
  write(worktree, HOLD_TEST_FILE, holdBody);
  write(worktree, BOOT_CONFIG_FILE, configBody);
  return { configFile: BOOT_CONFIG_FILE };
};

export type LaneScaffoldInput = {
  worktree: string;
  projectConfigFile: string;
  manifestPath: string;
  cacheDir: string;
  laneWorkers: number;
  dbSetupFile: string;
  templates: readonly string[];
};

export const writeLaneScaffold = ({
  worktree,
  projectConfigFile,
  manifestPath,
  cacheDir,
  laneWorkers,
  dbSetupFile,
  templates,
}: LaneScaffoldInput): { configFile: string } => {
  const dbSetupBody = [
    `import { randomUUID } from "node:crypto"`,
    `import { Client } from "pg"`,
    `import { afterAll, afterEach, beforeEach } from "vitest"`,
    ``,
    `const TEMPLATE_ENV = ${quoted(SEED_TEMPLATE_ENV)}`,
    ``,
    `type TestDb = { url: string; appUrl: string; name: string }`,
    ``,
    `let admin: Client | null = null`,
    `let current: TestDb | null = null`,
    ``,
    `const templates = (): string[] => {`,
    `  const listed = (process.env[TEMPLATE_ENV] ?? "")`,
    `    .split(",")`,
    `    .map((name) => name.trim())`,
    `    .filter((name) => name.length > 0)`,
    `  if (listed.length === 0) {`,
    `    throw new Error(`,
    `      TEMPLATE_ENV +`,
    `        " is empty, so this worker has no seed template of its own and would queue behind every other worker; start the campaign again so the lane config declares it"`,
    `    )`,
    `  }`,
    `  return listed`,
    `}`,
    ``,
    `const workerNumber = (): number => {`,
    `  const parsed = Number(process.env.VITEST_WORKER_ID)`,
    `  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1`,
    `}`,
    ``,
    `const workerTemplate = (): string => {`,
    `  const names = templates()`,
    `  const index = (workerNumber() - 1) % names.length`,
    `  const name = names[index]`,
    `  if (name === undefined) throw new Error("no seed template for worker " + workerNumber())`,
    `  return name`,
    `}`,
    ``,
    `const baseOf = (url: string): string => url.slice(0, url.lastIndexOf("/"))`,
    ``,
    `const superUrl = (): string => {`,
    `  const url = process.env.__TEST_DB_URL__`,
    `  if (!url) throw new Error("__TEST_DB_URL__ is not set, so the campaign environment is not attached")`,
    `  return url`,
    `}`,
    ``,
    `const closeAdmin = async (): Promise<void> => {`,
    `  const client = admin`,
    `  admin = null`,
    `  if (client !== null) await client.end().catch(() => undefined)`,
    `}`,
    ``,
    `const adminQuery = async (sql: string, params: readonly string[] = []): Promise<void> => {`,
    `  try {`,
    `    if (admin === null) {`,
    `      const client = new Client({ connectionString: baseOf(superUrl()) + "/postgres" })`,
    `      await client.connect()`,
    `      admin = client`,
    `    }`,
    `    await admin.query(sql, [...params])`,
    `  } catch (error) {`,
    `    await closeAdmin()`,
    `    throw error`,
    `  }`,
    `}`,
    ``,
    `const sanitized = (value: string): string => value.replace(/\\W/g, "_")`,
    ``,
    `const createTestDb = async (): Promise<TestDb> => {`,
    `  const base = baseOf(superUrl())`,
    `  const appBase = process.env.__TEST_APP_DB_URL__`,
    `  const name =`,
    `    "t_" + sanitized(process.env.VITEST_WORKER_ID ?? "w") + "_" + sanitized(randomUUID().slice(0, 8))`,
    `  await adminQuery('CREATE DATABASE "' + name + '" TEMPLATE "' + workerTemplate() + '"')`,
    `  return {`,
    `    url: base + "/" + name,`,
    `    appUrl: (appBase ? baseOf(appBase) : base) + "/" + name,`,
    `    name,`,
    `  }`,
    `}`,
    ``,
    `const dropTestDb = async (name: string): Promise<void> => {`,
    `  await adminQuery(${quoted(DISCONNECT_SQL)}, [name])`,
    `  await adminQuery('DROP DATABASE IF EXISTS "' + name + '"')`,
    `}`,
    ``,
    `beforeEach(async () => {`,
    `  current = await createTestDb()`,
    `  process.env.__TEST_DB_URL__ = current.url`,
    `  process.env.__TEST_APP_DB_URL__ = current.appUrl`,
    `  process.env.DATABASE_URL = current.appUrl`,
    `}, 60_000)`,
    ``,
    `afterEach(async () => {`,
    `  const created = current`,
    `  current = null`,
    `  if (created === null) return`,
    `  try {`,
    `    await dropTestDb(created.name)`,
    `  } catch (error) {`,
    `    console.warn("[forge] could not drop the test database " + created.name, error)`,
    `  }`,
    `}, 60_000)`,
    ``,
    `afterAll(closeAdmin)`,
    ``,
  ].join("\n");

  const attachBody = [
    `import { readFileSync } from "node:fs"`,
    ``,
    `const MANIFEST_PATH = ${quoted(manifestPath)}`,
    ``,
    `type Manifest = { env?: Record<string, string> }`,
    ``,
    `export default function forgeAttach() {`,
    `  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest`,
    `  const carried = manifest.env ?? {}`,
    `  if (Object.keys(carried).length === 0) {`,
    `    throw new Error(`,
    `      "the campaign manifest carried no environment, so the containers are not reachable: " +`,
    `        MANIFEST_PATH`,
    `    )`,
    `  }`,
    `  for (const [key, value] of Object.entries(carried)) {`,
    `    process.env[key] = value`,
    `  }`,
    `  return () => undefined`,
    `}`,
    ``,
  ].join("\n");

  const configBody = [
    `import { defineConfig } from "vitest/config"`,
    ``,
    `import baseConfig from ${quoted(
      specifierFrom(SCAFFOLD_DIRECTORY, projectConfigFile)
    )}`,
    ``,
    `const CACHE_DIR = ${quoted(cacheDir)}`,
    `const DB_SETUP_FILE = ${quoted(dbSetupFile)}`,
    `const FORGE_DB_SETUP_FILE = ${quoted(`./${LANE_DB_SETUP_FILE}`)}`,
    ``,
    `type ProjectShape = { test?: { setupFiles?: string | string[] } }`,
    ``,
    `const isProject = (value: unknown): value is ProjectShape =>`,
    `  typeof value === "object" && value !== null`,
    ``,
    `let swapped = 0`,
    ``,
    `const swapDbSetup = (setupFiles: string | string[] | undefined): string[] => {`,
    `  const listed = typeof setupFiles === "string" ? [setupFiles] : (setupFiles ?? [])`,
    `  return listed.map((file) => {`,
    `    if (!file.endsWith(DB_SETUP_FILE)) return file`,
    `    swapped += 1`,
    `    return FORGE_DB_SETUP_FILE`,
    `  })`,
    `}`,
    ``,
    `const baseTest = baseConfig.test ?? {}`,
    `const baseProjects = baseTest.projects ?? []`,
    `const projects = baseProjects.map((project) =>`,
    `  isProject(project)`,
    `    ? {`,
    `        ...project,`,
    `        cacheDir: CACHE_DIR,`,
    `        test: { ...project.test, setupFiles: swapDbSetup(project.test?.setupFiles) },`,
    `      }`,
    `    : project`,
    `)`,
    ``,
    `if (swapped === 0) {`,
    `  throw new Error(`,
    `    "no project sets up " +`,
    `      DB_SETUP_FILE +`,
    `      ", so this lane would copy every test database from the one shared seed database and queue behind every other lane; start the campaign again with dbSetupFile pointing at the project's per test database setup"`,
    `  )`,
    `}`,
    ``,
    `export default defineConfig({`,
    `  ...baseConfig,`,
    `  root: ${quoted(worktree)},`,
    `  cacheDir: CACHE_DIR,`,
    `  test: {`,
    `    ...baseTest,`,
    `    env: { ...baseTest.env, ${SEED_TEMPLATE_ENV}: ${quoted(
      templates.join(",")
    )} },`,
    `    projects,`,
    `    globalSetup: [${quoted(`./${ATTACH_SETUP_FILE}`)}],`,
    `    minWorkers: 1,`,
    `    maxWorkers: ${laneWorkers},`,
    `    fileParallelism: false,`,
    `  },`,
    `})`,
    ``,
  ].join("\n");

  write(worktree, ATTACH_SETUP_FILE, attachBody);
  write(worktree, LANE_DB_SETUP_FILE, dbSetupBody);
  write(worktree, LANE_CONFIG_FILE, configBody);
  return { configFile: LANE_CONFIG_FILE };
};

export const scaffoldPath = (worktree: string, file: string): string =>
  join(worktree, ...file.split("/"));

export const DRIVER_FILE = `${SCAFFOLD_DIRECTORY}/lane-driver.mjs`;

export const COMMAND_FD = 3;

export const REPLY_FD = 4;

const CLOSE_GRACE_MS = 20_000;

export type DriverScaffoldInput = {
  worktree: string;
  configPath: string;
  rawReportPath: string;
  filters: readonly string[];
  bail: boolean;
};

export const writeDriverScaffold = ({
  worktree,
  configPath,
  rawReportPath,
  filters,
  bail,
}: DriverScaffoldInput): { driverFile: string } => {
  const body = [
    `import { createReadStream, existsSync, renameSync, rmSync, writeSync } from "node:fs"`,
    `import { createInterface } from "node:readline"`,
    `import { createVitest } from "vitest/node"`,
    ``,
    `const CONFIG_PATH = ${quoted(configPath)}`,
    `const RAW_REPORT_PATH = ${quoted(rawReportPath)}`,
    `const FILTERS = ${JSON.stringify([...filters])}`,
    `const BAIL = ${bail ? "1" : "0"}`,
    ``,
    `const reply = (payload) => {`,
    `  writeSync(${String(REPLY_FD)}, JSON.stringify(payload) + "\\n")`,
    `}`,
    ``,
    `const messageOf = (error) =>`,
    `  error instanceof Error ? (error.stack ?? error.message) : String(error)`,
    ``,
    `const release = async (vitest) => {`,
    `  await Promise.race([`,
    `    vitest.close(),`,
    `    new Promise((settle) => setTimeout(settle, ${String(
      CLOSE_GRACE_MS
    )})),`,
    `  ]).catch(() => undefined)`,
    `}`,
    ``,
    `const runOne = async (vitest, specifications, command) => {`,
    `  const startedAt = Date.now()`,
    `  rmSync(RAW_REPORT_PATH, { force: true })`,
    `  rmSync(command.reportPath, { force: true })`,
    `  for (const path of command.invalidate) vitest.invalidateFile(path)`,
    `  let error = null`,
    `  try {`,
    `    await vitest.runTestSpecifications(specifications)`,
    `  } catch (thrown) {`,
    `    error = messageOf(thrown)`,
    `  }`,
    `  const wrote = existsSync(RAW_REPORT_PATH)`,
    `  if (wrote) renameSync(RAW_REPORT_PATH, command.reportPath)`,
    `  reply({`,
    `    kind: "result",`,
    `    mutantId: command.mutantId,`,
    `    report: wrote,`,
    `    error,`,
    `    durationMs: Date.now() - startedAt,`,
    `  })`,
    `}`,
    ``,
    `const main = async () => {`,
    `  const vitest = await createVitest("test", {`,
    `    config: CONFIG_PATH,`,
    `    watch: false,`,
    `    reporters: ["json"],`,
    `    outputFile: { json: RAW_REPORT_PATH },`,
    `    ...(BAIL > 0 ? { bail: BAIL } : {}),`,
    `  })`,
    `  await vitest.init()`,
    `  const specifications = await vitest.globTestSpecifications(FILTERS)`,
    `  if (specifications.length === 0) {`,
    `    reply({ kind: "fatal", error: "no test file matched " + FILTERS.join(", ") })`,
    `    await release(vitest)`,
    `    process.exit(1)`,
    `  }`,
    `  reply({ kind: "ready", specifications: specifications.length })`,
    `  const commands = createInterface({`,
    `    input: createReadStream(null, { fd: ${String(COMMAND_FD)} }),`,
    `  })`,
    `  for await (const line of commands) {`,
    `    const text = line.trim()`,
    `    if (text === "") continue`,
    `    const command = JSON.parse(text)`,
    `    if (command.kind === "stop") break`,
    `    await runOne(vitest, specifications, command)`,
    `  }`,
    `  await release(vitest)`,
    `  process.exit(0)`,
    `}`,
    ``,
    `main().catch(async (error) => {`,
    `  reply({ kind: "fatal", error: messageOf(error) })`,
    `  process.exit(1)`,
    `})`,
    ``,
  ].join("\n");

  write(worktree, DRIVER_FILE, body);
  return { driverFile: DRIVER_FILE };
};
