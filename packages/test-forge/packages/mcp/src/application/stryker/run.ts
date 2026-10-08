import {
  rangeArgumentsOf,
  siteKey,
} from "../../domain/stryker/scope.ts";
import { offsetOf, parseStrykerReport } from "../../domain/stryker/report.ts";
import type { ReportMutant, ReportTest } from "../../domain/stryker/report.ts";
import {
  TIMEOUT_FACTOR,
  TIMEOUT_MS,
  outcomeOfStatus,
  strykerConcurrency,
} from "../../domain/stryker/settings.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  planStrykerSites,
  recordStrykerMutants,
} from "../../infrastructure/db/stryker-store.ts";
import type { StrykerMutantRecord } from "../../infrastructure/db/stryker-store.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import { MAX_TIMEOUT_MS, runProcess } from "../../infrastructure/process.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import {
  ensureScaffoldIgnored,
  harnessPathsOf,
  kindPathsOf,
  writeKindScaffold,
} from "../../infrastructure/stryker-files.ts";
import {
  DEFAULT_DB_SETUP_FILE,
  DEFAULT_PROJECT_CONFIG_FILE,
  harnessStatus,
} from "./harness.ts";
import { resolveScope } from "./scope.ts";
import type { StrykerScopeInput } from "./scope.ts";
import { readFileSync, rmSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTANT_OUTCOMES } from "test-forge-contracts/mutation";
import type { Kill, MutantOutcome } from "test-forge-contracts/mutation";
import type {
  MutantSite,
  ScopeSelection,
  StrykerCounts,
  StrykerKindRun,
  StrykerRunResult,
} from "test-forge-contracts/stryker";

export type StrykerRunInput = StrykerScopeInput & {
  runId?: number | undefined;
  label?: string | undefined;
  concurrency?: number | undefined;
  timeoutFactor?: number | undefined;
  timeoutMs?: number | undefined;
  inPlace?: boolean | undefined;
  projectConfigFile?: string | undefined;
  dbSetupFile?: string | undefined;
  strykerTimeoutMs?: number | undefined;
  onPlanned?: (() => void) | undefined;
  onMutantTested?: ((tested: TestedMutant) => void) | undefined;
};

export type TestedMutant = {
  id: number;
  site: MutantSite;
  originalText: string;
  outcome: MutantOutcome;
};

const LIVE_POLL_MS = 1000;

type KindOutcome = {
  run: StrykerKindRun;
  records: StrykerMutantRecord[];
};

const MAX_LOG_TAIL = 3000;

const STRYKER_BIN = join(
  dirname(
    fileURLToPath(import.meta.resolve("@stryker-mutator/core/package.json")),
  ),
  "bin",
  "stryker.js",
);

const asKill = (test: ReportTest): Kill => ({
  file: test.file,
  name: test.name,
});

const tally = (counts: StrykerCounts, outcome: MutantOutcome): void => {
  counts[outcome] = (counts[outcome] ?? 0) + 1;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const eventTimestamps = (
  path: string,
): { dryRunAt: number | null; reportAt: number | null } => {
  const text = readTextFile(path);
  const stamps: { dryRunAt: number | null; reportAt: number | null } = {
    dryRunAt: null,
    reportAt: null,
  };
  if (text === null) return stamps;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const event: unknown = JSON.parse(line);
      if (!isRecord(event) || typeof event.ts !== "number") continue;
      if (event.event === "dryRunCompleted") stamps.dryRunAt = event.ts;
      if (event.event === "reportReady") stamps.reportAt = event.ts;
    } catch {
      continue;
    }
  }
  return stamps;
};

const sourceSlice = (root: string, site: MutantSite): string => {
  const source = readTextFile(join(root, site.file));
  return source === null
    ? ""
    : source.slice(offsetOf(source, site.start), offsetOf(source, site.end));
};

const sitesOfEvent = (
  root: string,
  line: string,
): { site: MutantSite; status: string } | null => {
  try {
    const event: unknown = JSON.parse(line);
    if (!isRecord(event) || event.event !== "mutantTested") return null;
    const { file, mutator, replacement, location, status } = event;
    if (
      typeof file !== "string" ||
      typeof mutator !== "string" ||
      typeof status !== "string" ||
      !isRecord(location) ||
      !isRecord(location.start) ||
      !isRecord(location.end)
    ) {
      return null;
    }
    const { start, end } = location;
    if (
      typeof start.line !== "number" ||
      typeof start.column !== "number" ||
      typeof end.line !== "number" ||
      typeof end.column !== "number"
    ) {
      return null;
    }
    return {
      status,
      site: {
        file: relative(root, file),
        mutator,
        replacement: typeof replacement === "string" ? replacement : "",
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      },
    };
  } catch {
    return null;
  }
};

const followEvents = (
  root: string,
  eventsPath: string,
  ids: ReadonlyMap<string, number>,
  originals: ReadonlyMap<string, string>,
  onMutantTested: (tested: TestedMutant) => void,
): (() => void) => {
  let offset = 0;
  let carry = "";
  const poll = (): void => {
    let size: number;
    try {
      size = statSync(eventsPath).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0;
    if (size === offset) return;
    const fresh = readFileSync(eventsPath).subarray(offset, size).toString("utf8");
    offset = size;
    const lines = `${carry}${fresh}`.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = sitesOfEvent(root, line);
      if (parsed === null) continue;
      const key = siteKey(parsed.site);
      const id = ids.get(key);
      if (id === undefined) continue;
      onMutantTested({
        id,
        site: parsed.site,
        originalText: originals.get(key) ?? "",
        outcome: outcomeOfStatus(parsed.status),
      });
    }
  };
  const timer = setInterval(poll, LIVE_POLL_MS);
  return () => {
    clearInterval(timer);
    poll();
  };
};

const recordOf = (
  mutant: ReportMutant,
  outcome: MutantOutcome,
): StrykerMutantRecord => ({
  site: mutant.site,
  originalText: mutant.originalText,
  outcome,
  strykerStatus: mutant.status,
  coveredBy: mutant.coveredBy.map(asKill),
  killedBy: mutant.killedBy.map(asKill),
});

const unrunRecord = (site: MutantSite, status: string): StrykerMutantRecord => ({
  site,
  originalText: "",
  outcome: status === "NoCoverage" ? "no_coverage" : "error",
  strykerStatus: status,
  coveredBy: [],
  killedBy: [],
});

const classify = (
  reported: readonly ReportMutant[],
  selection: ScopeSelection,
): { records: StrykerMutantRecord[]; counts: StrykerCounts; missing: MutantSite[] } => {
  const wanted = new Map(
    selection.inScope.map((site) => [siteKey(site), site] as const),
  );
  const counts: StrykerCounts = {};
  const records: StrykerMutantRecord[] = [];
  for (const mutant of reported) {
    const inScope = wanted.delete(siteKey(mutant.site));
    const outcome = inScope ? outcomeOfStatus(mutant.status) : "out_of_scope";
    records.push(recordOf(mutant, outcome));
    tally(counts, outcome);
  }
  const missing = [...wanted.values()];
  for (const site of missing) {
    records.push(unrunRecord(site, "Missing"));
    tally(counts, "error");
  }
  return { records, counts, missing };
};

const runKind = async (
  input: StrykerRunInput,
  root: string,
  selection: ScopeSelection,
  label: string,
): Promise<KindOutcome | { error: string }> => {
  const startedAt = Date.now();
  const harnessPaths = harnessPathsOf(root);
  const scaffold = writeKindScaffold({
    worktree: root,
    kind: selection.kind,
    projectConfigFile: input.projectConfigFile ?? DEFAULT_PROJECT_CONFIG_FILE,
    dbSetupFile: input.dbSetupFile ?? DEFAULT_DB_SETUP_FILE,
    manifestPath: harnessPaths.manifestPath,
    testFiles: selection.testFiles,
    mutate: rangeArgumentsOf(selection.inScope),
    concurrency: input.concurrency ?? strykerConcurrency(cpus().length),
    timeoutFactor: input.timeoutFactor ?? TIMEOUT_FACTOR,
    timeoutMs: input.timeoutMs ?? TIMEOUT_MS,
    inPlace: input.inPlace ?? false,
    runId: label,
  });
  rmSync(kindPathsOf(root, selection.kind).tempDirectory, {
    recursive: true,
    force: true,
  });
  rmSync(scaffold.eventsPath, { force: true });
  rmSync(scaffold.reportPath, { force: true });
  let stopFollowing = (): void => undefined;
  if (input.runId !== undefined) {
    const originals = new Map(
      selection.inScope.map((site) => [siteKey(site), sourceSlice(root, site)] as const),
    );
    const ids = planStrykerSites(
      openDb(),
      await projectKeyOf(root),
      input.runId,
      selection.inScope.map((site) => ({
        site,
        originalText: originals.get(siteKey(site)) ?? "",
      })),
    );
    input.onPlanned?.();
    if (input.onMutantTested !== undefined) {
      stopFollowing = followEvents(
        root,
        scaffold.eventsPath,
        ids,
        originals,
        input.onMutantTested,
      );
    }
  }
  const execution = await runProcess({
    command: process.execPath,
    args: [STRYKER_BIN, "run", scaffold.strykerConfigPath],
    cwd: root,
    timeoutMs: input.strykerTimeoutMs ?? MAX_TIMEOUT_MS,
    env: { FORCE_COLOR: "0", NO_COLOR: "1", FORGE_STRYKER_EVENTS: scaffold.eventsPath },
  }).finally(() => stopFollowing());
  const logTail = `${execution.stdout}\n${execution.stderr}`.slice(-MAX_LOG_TAIL);
  const reportText = readTextFile(scaffold.reportPath);
  if (execution.code !== 0 || reportText === null) {
    return {
      error: `Stryker ${selection.kind} run failed (exit ${String(execution.code)}): ${logTail}`,
    };
  }
  const { records, counts, missing } = classify(
    parseStrykerReport(reportText),
    selection,
  );
  const stamps = eventTimestamps(scaffold.eventsPath);
  const counted = records.length - (counts.out_of_scope ?? 0);
  return {
    records,
    run: {
      kind: selection.kind,
      ranMutants: records.length - missing.length,
      inScope: counted,
      outOfScope: counts.out_of_scope ?? 0,
      uncovered: 0,
      testFiles: selection.testFiles,
      counts,
      reportPath: scaffold.reportPath,
      eventsPath: scaffold.eventsPath,
      dryRunMs:
        stamps.dryRunAt === null ? null : stamps.dryRunAt - startedAt,
      mutationMs:
        stamps.dryRunAt === null || stamps.reportAt === null
          ? null
          : stamps.reportAt - stamps.dryRunAt,
      totalMs: Date.now() - startedAt,
      logTail,
    },
  };
};

const uncoveredRun = (selection: ScopeSelection): KindOutcome => ({
  records: selection.uncovered.map((site) => unrunRecord(site, "NoCoverage")),
  run: {
    kind: selection.kind,
    ranMutants: 0,
    inScope: selection.uncovered.length,
    outOfScope: 0,
    uncovered: selection.uncovered.length,
    testFiles: [],
    counts: { no_coverage: selection.uncovered.length },
    reportPath: null,
    eventsPath: null,
    dryRunMs: null,
    mutationMs: null,
    totalMs: 0,
    logTail: "",
  },
});

const sumCounts = (runs: readonly StrykerKindRun[]): StrykerCounts => {
  const total: StrykerCounts = {};
  for (const outcome of MUTANT_OUTCOMES) {
    const count = runs.reduce(
      (sum, kindRun) => sum + (kindRun.counts[outcome] ?? 0),
      0,
    );
    if (count > 0) total[outcome] = count;
  }
  return total;
};

export const strykerRun = async (
  input: StrykerRunInput,
): Promise<StrykerRunResult> => {
  const startedAt = Date.now();
  const scope = await resolveScope(input);
  if (!scope.ok) return scope;
  const { root, selections } = scope;
  ensureScaffoldIgnored(root);
  const needsHarness = selections.some(
    (selection) => selection.kind === "backend" && selection.inScope.length > 0,
  );
  if (needsHarness) {
    const status = await harnessStatus({ cwd: root });
    if (!status.running || !status.manifestReady) {
      return {
        ok: false,
        reason:
          "the backend harness is not running; call harnessStart for this worktree first",
      };
    }
  }

  const label = input.label ?? String(input.runId ?? Date.now());
  const outcomes: KindOutcome[] = [];
  const strykerStartedAt = Date.now();
  for (const selection of selections) {
    if (selection.uncovered.length > 0) outcomes.push(uncoveredRun(selection));
    if (selection.inScope.length === 0) continue;
    const outcome = await runKind(input, root, selection, label);
    if ("error" in outcome) return { ok: false, reason: outcome.error };
    outcomes.push(outcome);
  }
  const strykerMs = Date.now() - strykerStartedAt;

  const ledgerStartedAt = Date.now();
  const records = outcomes.flatMap((outcome) => outcome.records);
  const ledgerRows =
    input.runId === undefined
      ? 0
      : recordStrykerMutants(
          openDb(),
          await projectKeyOf(root),
          input.runId,
          records,
        );
  const ledgerMs = Date.now() - ledgerStartedAt;

  const runs = outcomes.map((outcome) => outcome.run);
  const counts = sumCounts(runs);
  const outOfScope = counts.out_of_scope ?? 0;
  const firstReport = runs.find((kindRun) => kindRun.reportPath !== null);
  return {
    ok: true,
    runId: input.runId ?? null,
    baseRef: scope.baseRef,
    mergeBase: scope.mergeBase,
    scopeRule: scope.scopeRule,
    inScope: runs.reduce((total, kindRun) => total + kindRun.inScope, 0),
    outOfScope,
    overlapOnly: selections.reduce(
      (total, selection) => total + selection.overlapOnly.length,
      0,
    ),
    uncovered: runs.reduce((total, kindRun) => total + kindRun.uncovered, 0),
    instrumentFailures: scope.instrumentFailures,
    counts,
    durations: {
      selectionMs: scope.selectionMs,
      strykerMs,
      ledgerMs,
      totalMs: Date.now() - startedAt,
    },
    reportPath: firstReport?.reportPath ?? null,
    runs,
    ledgerRows,
  };
};
