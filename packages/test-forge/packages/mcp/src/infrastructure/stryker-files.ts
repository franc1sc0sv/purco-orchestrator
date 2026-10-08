import { SCAFFOLD_DIRECTORY } from "./campaign-files.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { ProjectKind } from "test-forge-contracts/stryker";

export const STRYKER_DIRECTORY = `${SCAFFOLD_DIRECTORY}/stryker`;

export const STRYKER_RUN_DIRECTORY = `${SCAFFOLD_DIRECTORY}/stryker-run`;

export const SANDBOX_IGNORE_PATTERNS: readonly string[] = [
  `/${STRYKER_RUN_DIRECTORY}`,
  "/.next",
  "/coverage",
];

const TEMPLATE_DIRECTORY = join(import.meta.dirname, "stryker-scaffold");

const BOOT_SETUP_FILE = `${STRYKER_DIRECTORY}/boot-setup.ts`;

const HOLD_TEST_FILE = `${STRYKER_DIRECTORY}/hold.test.ts`;

export const BOOT_CONFIG_FILE = `${STRYKER_DIRECTORY}/boot.config.mts`;

const ATTACH_SETUP_FILE = `${STRYKER_DIRECTORY}/attach-setup.ts`;

const WORKER_DB_SETUP_FILE = `${STRYKER_DIRECTORY}/db-per-worker.ts`;

export const NO_TSCONFIG_FILE = `${SCAFFOLD_DIRECTORY}/no-tsconfig.json`;

const DRY_RUN_TIMEOUT_MINUTES = 20;

const PHASE_REPORTER_FILE = `${STRYKER_DIRECTORY}/phase-reporter.mjs`;

const toPosix = (path: string): string => path.split(sep).join("/");

const specifierFrom = (fromDirectory: string, target: string): string => {
  const relativePath = toPosix(relative(fromDirectory, target));
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};

const template = (name: string): string =>
  readFileSync(join(TEMPLATE_DIRECTORY, name), "utf8");

const filled = (
  name: string,
  replacements: Readonly<Record<string, string>>,
): string =>
  Object.entries(replacements).reduce(
    (body, [token, value]) => body.replaceAll(token, value),
    template(name),
  );

export const ensureScaffoldIgnored = (worktree: string): void => {
  const ignoreFile = join(worktree, SCAFFOLD_DIRECTORY, ".gitignore");
  mkdirSync(dirname(ignoreFile), { recursive: true });
  writeFileSync(ignoreFile, "*\n");
};

const write = (worktree: string, file: string, body: string): string => {
  const absolute = join(worktree, ...file.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
  return absolute;
};

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export type HarnessPaths = {
  directory: string;
  manifestPath: string;
  stopFilePath: string;
  bootLogPath: string;
  statePath: string;
};

export const harnessPathsOf = (worktree: string): HarnessPaths => {
  const directory = join(worktree, ...STRYKER_RUN_DIRECTORY.split("/"), "harness");
  return {
    directory,
    manifestPath: join(directory, "manifest.json"),
    stopFilePath: join(directory, "stop"),
    bootLogPath: join(directory, "boot.log"),
    statePath: join(directory, "state.json"),
  };
};

export type KindPaths = {
  directory: string;
  tempDirectory: string;
  incrementalPath: string;
  configPath: string;
  reportPath: (runId: string) => string;
  eventsPath: (runId: string) => string;
};

export const kindPathsOf = (worktree: string, kind: ProjectKind): KindPaths => {
  const directory = join(worktree, ...STRYKER_RUN_DIRECTORY.split("/"), kind);
  return {
    directory,
    tempDirectory: join(worktree, ...STRYKER_RUN_DIRECTORY.split("/"), `tmp-${kind}`),
    incrementalPath: join(directory, "incremental.json"),
    configPath: join(directory, "stryker.config.json"),
    reportPath: (runId) => join(directory, `report-${runId}.json`),
    eventsPath: (runId) => join(directory, `events-${runId}.jsonl`),
  };
};

export type HarnessScaffoldInput = {
  worktree: string;
  projectConfigFile: string;
  globalSetupFile: string;
  seedDbName: string;
  templates: readonly string[];
  fastPostgres: Readonly<Record<string, string>>;
  holdTimeoutMs: number;
  bootTimeoutMs: number;
  paths: HarnessPaths;
};

export const writeHarnessScaffold = ({
  worktree,
  projectConfigFile,
  globalSetupFile,
  seedDbName,
  templates,
  fastPostgres,
  holdTimeoutMs,
  bootTimeoutMs,
  paths,
}: HarnessScaffoldInput): { configFile: string } => {
  const config = json({
    manifestPath: paths.manifestPath,
    stopFilePath: paths.stopFilePath,
    seedDbName,
    templates,
    fastPostgres,
    holdTimeoutMs,
    bootTimeoutMs,
  });
  const scaffoldDirectory = join(worktree, ...STRYKER_DIRECTORY.split("/"));
  const specifierOf = (file: string): string =>
    specifierFrom(scaffoldDirectory, join(worktree, file));
  write(
    worktree,
    BOOT_SETUP_FILE,
    filled("boot-setup.ts.tpl", {
      __CONFIG__: config,
      __GLOBAL_SETUP__: specifierOf(globalSetupFile),
    }),
  );
  write(
    worktree,
    HOLD_TEST_FILE,
    filled("hold.test.ts.tpl", { __CONFIG__: config }),
  );
  write(
    worktree,
    BOOT_CONFIG_FILE,
    filled("boot.config.mts.tpl", {
      __CONFIG__: config,
      __PROJECT_CONFIG__: specifierOf(projectConfigFile),
    }),
  );
  return { configFile: BOOT_CONFIG_FILE };
};

export type KindScaffoldInput = {
  worktree: string;
  kind: ProjectKind;
  projectConfigFile: string;
  dbSetupFile: string;
  manifestPath: string;
  testFiles: readonly string[];
  mutate: readonly string[];
  concurrency: number;
  timeoutFactor: number;
  timeoutMs: number;
  inPlace: boolean;
  runId: string;
};

export type KindScaffold = {
  strykerConfigPath: string;
  vitestConfigFile: string;
  reportPath: string;
  eventsPath: string;
  incrementalPath: string;
};

type VitestConfigInput = {
  worktree: string;
  kind: ProjectKind;
  projectConfigFile: string;
  dbSetupFile: string;
  manifestPath: string;
  testFiles: readonly string[];
};

const writeVitestConfig = (
  input: VitestConfigInput,
  vitestConfigFile: string,
): void => {
  const { worktree, kind } = input;
  const scaffoldDirectory = join(worktree, ...STRYKER_DIRECTORY.split("/"));
  write(
    worktree,
    ATTACH_SETUP_FILE,
    filled("attach-setup.ts.tpl", {
      __CONFIG__: json({ manifestPath: input.manifestPath }),
    }),
  );
  write(worktree, WORKER_DB_SETUP_FILE, template("db-per-worker.ts.tpl"));
  write(
    worktree,
    vitestConfigFile,
    filled("vitest.stryker.config.mts.tpl", {
      __PROJECT_CONFIG__: specifierFrom(
        scaffoldDirectory,
        join(worktree, input.projectConfigFile),
      ),
      __CONFIG__: json({
        projectName: kind,
        attach: kind === "backend",
        dbSetupFile: input.dbSetupFile,
        workerDbSetup: WORKER_DB_SETUP_FILE,
        attachSetup: `./${ATTACH_SETUP_FILE}`,
        testFiles: input.testFiles,
      }),
    }),
  );
};

export const writeSoloScaffold = (
  input: VitestConfigInput,
): { vitestConfigFile: string } => {
  const vitestConfigFile = `${STRYKER_DIRECTORY}/vitest.${input.kind}.solo.config.mts`;
  writeVitestConfig(input, vitestConfigFile);
  return { vitestConfigFile };
};

export const writeKindScaffold = (input: KindScaffoldInput): KindScaffold => {
  const { worktree, kind } = input;
  const paths = kindPathsOf(worktree, kind);
  const vitestConfigFile = `${STRYKER_DIRECTORY}/vitest.${kind}.config.mts`;
  writeVitestConfig(input, vitestConfigFile);
  const strykerApiPlugin = import.meta.resolve("@stryker-mutator/api/plugin");
  const reporterPath = write(
    worktree,
    PHASE_REPORTER_FILE,
    filled("phase-reporter.mjs.tpl", {
      __STRYKER_API_PLUGIN__: strykerApiPlugin,
    }),
  );
  const reportPath = paths.reportPath(input.runId);
  const eventsPath = paths.eventsPath(input.runId);
  mkdirSync(paths.directory, { recursive: true });
  writeFileSync(
    paths.configPath,
    json({
      testRunner: "vitest",
      vitest: { configFile: vitestConfigFile },
      plugins: ["@stryker-mutator/vitest-runner", reporterPath],
      coverageAnalysis: "perTest",
      mutate: input.mutate,
      ignoreStatic: false,
      tsconfigFile: NO_TSCONFIG_FILE,
      tempDirName: relative(worktree, paths.tempDirectory),
      inPlace: input.inPlace,
      ignorePatterns: SANDBOX_IGNORE_PATTERNS,
      concurrency: input.concurrency,
      timeoutFactor: input.timeoutFactor,
      timeoutMS: input.timeoutMs,
      dryRunTimeoutMinutes: DRY_RUN_TIMEOUT_MINUTES,
      reporters: ["json", "clear-text", "forge-events"],
      clearTextReporter: {
        allowColor: false,
        logTests: false,
        reportTests: false,
      },
      jsonReporter: { fileName: reportPath },
      incremental: true,
      incrementalFile: paths.incrementalPath,
      logLevel: "info",
    }),
  );
  return {
    strykerConfigPath: paths.configPath,
    vitestConfigFile,
    reportPath,
    eventsPath,
    incrementalPath: paths.incrementalPath,
  };
};
