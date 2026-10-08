import fs from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PredicateId, WorkItem } from "test-forge-contracts/gates";
import type { MutationPassResult } from "test-forge-contracts/stryker";
import { astCheckBatch } from "test-forge-mcp-server/src/application/analysis/check-batch.ts";
import { rulesFor, type ApplicableRule } from "test-forge-mcp-server/src/application/codex/rules-for.ts";
import { escalationOpen } from "test-forge-mcp-server/src/application/escalation/open.ts";
import { escalationResolve } from "test-forge-mcp-server/src/application/escalation/resolve.ts";
import {
  evaluateGates,
  type GateCommands,
  type GatesEvaluation,
} from "test-forge-mcp-server/src/application/gates/evaluate.ts";
import { WAIVER_KINDS } from "test-forge-mcp-server/src/application/ledger/ledger-input.ts";
import { runEnd } from "test-forge-mcp-server/src/application/ledger/run-end.ts";
import { runReopen } from "test-forge-mcp-server/src/application/ledger/run-reopen.ts";
import { runStart } from "test-forge-mcp-server/src/application/ledger/run-start.ts";
import { findingUpsertBatch } from "test-forge-mcp-server/src/application/ledger/finding-upsert-batch.ts";
import { state } from "test-forge-mcp-server/src/application/ledger/state.ts";
import { unitUpsertBatch } from "test-forge-mcp-server/src/application/ledger/unit-upsert-batch.ts";
import { verdictRecordBatch } from "test-forge-mcp-server/src/application/ledger/verdict-record-batch.ts";
import { waiverRecordBatch } from "test-forge-mcp-server/src/application/ledger/waiver-record-batch.ts";
import { mutationEquivalenceRecord } from "test-forge-mcp-server/src/application/mutation/equivalence-record.ts";
import { onShutdown } from "./lease.ts";
import { harnessStart, harnessStop } from "test-forge-mcp-server/src/application/stryker/harness.ts";
import { execSuite } from "test-forge-mcp-server/src/application/execution/run-suite.ts";
import { mutationPass } from "test-forge-mcp-server/src/application/stryker/mutation-pass.ts";
import { ATTACH_CONFIG_FILE } from "test-forge-mcp-server/src/infrastructure/stryker-files.ts";
import type { TestedMutant } from "test-forge-mcp-server/src/application/stryker/run.ts";
import { resolveScope } from "test-forge-mcp-server/src/application/stryker/scope.ts";
import { projectKindOf } from "test-forge-mcp-server/src/domain/stryker/scope.ts";
import { jobOf, runSoloJobs } from "test-forge-mcp-server/src/application/stryker/solo.ts";
import {
  TIMEOUT_FACTOR,
  TIMEOUT_MS,
  strykerConcurrency,
} from "test-forge-mcp-server/src/domain/stryker/settings.ts";
import { all, openDb } from "test-forge-mcp-server/src/infrastructure/db/connection.ts";
import { strykerRowsOf } from "test-forge-mcp-server/src/infrastructure/db/stryker-store.ts";
import {
  changedProductionFiles,
  fileSlug,
  readUnits,
  routeWork,
  scopeFor,
  storedRun,
  storeRun,
  testSurface,
  unitForFile,
  worktreeFiles,
  type ForgeScope,
  type LineRange,
  type Unit,
} from "./forge-units.ts";
import {
  baselineOf,
  changedTestFiles,
  digest,
  existingUnits,
  mapperFailure,
  protectedTestsOf,
  removedProtectedTests,
  type ExitDecision,
  type TestBaseline,
} from "./forge-harden.ts";
import {
  assignMutants,
  claimsOf,
  fallbackTestPath,
  fullNameOf,
  gateTests,
  KILLED_OUTCOMES,
  ledgerMutants,
  mutantLine,
  mutationExitDecision,
  newTestsOf,
  openMutants,
  outOfScopeCount,
  readTargets,
  refusalLine,
  renderMutationReport,
  sourcesWithoutTestFile,
  spanOf,
  testKeyOf,
  unresolvedMutants,
  type GateOutcome,
  type LedgerMutant,
} from "./forge-mutants.ts";
import type { PlanGatePayload, TestMode } from "./gate-payload.ts";
import {
  findingsFor,
  judgeOutcome,
  planMechanical,
  verdictsFor,
  type Judgement,
  type MechanicalRule,
} from "./forge-mechanical.ts";
import { eventOfLedger, plannedOfLedger } from "./mutant-events.ts";
import type { Size } from "./size.ts";
import type { ForgeRole, HumanItemKind, PhaseOutcome } from "./types.ts";

export type ForgeDefect = { findingKey: string; title: string };

export type ForgeJob = {
  role: ForgeRole;
  name: string;
  task: string;
  parts?: string[];
};

export type ForgeHost = {
  worktree: string;
  pack: string;
  ticket: string;
  base: string;
  scope?: ForgeScope;
  depth: "full" | "quick";
  mode?: TestMode;
  size?: Size;
  targets?: string;
  focus?: string;
  fresh: boolean;
  spawn: (job: ForgeJob) => Promise<PhaseOutcome>;
  ask: (kind: HumanItemKind, text: string, payload?: PlanGatePayload) => Promise<string | undefined>;
  decide: (question: string) => Promise<string>;
  event: (kind: "mutant_plan" | "mutant", text: string, data: Record<string, unknown>) => void;
  log: (line: string) => void;
  stopped: () => boolean;
};

export type ForgeResult = {
  status: "done" | "escalated";
  summary: string;
  runId: number | null;
  scope: ForgeScope | null;
  defects: ForgeDefect[];
  refusal?: string;
};

type ScopeInfo = {
  root: string;
  changed: Record<string, readonly LineRange[]>;
  files: string[];
  baseRef: string;
  mergeBase: string;
  scopeRule: string;
};

type Refusal = { file: string; line: string };

type Ctx = {
  host: ForgeHost;
  cwd: string;
  dir: string;
  scope: ForgeScope;
  runId: number;
  units: Unit[];
  commands: GateCommands;
  ruledTests: Set<string>;
  pass: number;
  mode: TestMode;
  baseline: TestBaseline;
  focus: string;
  rules: string;
  scopeInfo: ScopeInfo | undefined;
  eligible: Set<number>;
  credited: Set<string>;
  refused: Map<string, Refusal>;
  proofs: Record<string, number[]>;
  emitted: Map<number, string>;
  planned: boolean;
  inspected: Map<string, string>;
  mapperRan: boolean;
  failure: string | undefined;
};

type Mutant = { id: number; file_path: string; line: number; operator: string; outcome: string };

type Claim = { mutant_id: number; claimed_by: string; argument: string };

type Request = { kind: string; ref: string; reason: string };

type WaiverKind = (typeof WAIVER_KINDS)[number];

const isWaiverRequest = (request: Request): request is Request & { kind: WaiverKind } =>
  WAIVER_KINDS.some((kind) => kind === request.kind);

const CONCURRENCY = 3;
const USER = "user";
const RULES_LIMIT = 40_000;
const LIST_LIMIT = 12;

const SIGN_ALL = /^\s*(approve|approved|yes|ok)(\s+(them\s+)?all)?[.!]?\s*$/i;
const RESOLUTIONS = ["fixed", "rule-changed", "rejected", "waived"] as const;
const FIXABLE: readonly PredicateId[] = ["D1", "D2", "D3", "D4"];

const here = path.dirname(fileURLToPath(import.meta.url));

const tagged = (tag: string, body: string): string =>
  body ? `<${tag}>\n${body}\n</${tag}>` : "";

const inBatches = async <T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENCY).map(work))));
  }
  return results;
};

const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
};

const addLines = (work: Map<string, string[]>, file: string, lines: readonly string[]): void => {
  work.set(file, [...(work.get(file) ?? []), ...lines]);
};

const commandsFor = (scope: ForgeScope): GateCommands => ({
  test:
    scope === "backend"
      ? "NODE_OPTIONS='--max-old-space-size=8192' yarn vitest run --project backend"
      : "NODE_OPTIONS='--max-old-space-size=4096' yarn vitest run --project frontend",
  typecheck: "NODE_OPTIONS='--max-old-space-size=10240' yarn tsc",
  lint: "yarn lint",
});

const ATTACHED_BACKEND_TEST = `NODE_OPTIONS='--max-old-space-size=8192' yarn vitest run --maxWorkers=2 --config ${ATTACH_CONFIG_FILE}`;

const unitsFile = (ctx: Ctx): string => path.join(ctx.dir, "units.json");
const baselineFile = (ctx: Ctx): string => path.join(ctx.dir, "harden-baseline.json");
const eligibleFile = (ctx: Ctx): string => path.join(ctx.dir, "eligible-mutants.json");
const baselineDigestFile = (ctx: Ctx): string => path.join(ctx.dir, "baseline-digest.txt");
const proofsFile = (ctx: Ctx): string => path.join(ctx.dir, "kill-proofs.json");
const reportFile = (ctx: Ctx): string => path.join(ctx.dir, "mutation-report.md");
const requestsFile = (ctx: Ctx, file: string): string =>
  path.join(ctx.dir, `requests-${fileSlug(file)}.json`);
const targetsFile = (ctx: Ctx, file: string): string =>
  path.join(ctx.dir, `targets-${fileSlug(file)}.json`);
const holesFile = (ctx: Ctx, source: string): string =>
  path.join(ctx.dir, `holes-${fileSlug(source)}.json`);

const readJsonList = <T>(file: string, key: string): T[] => {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return Array.isArray(parsed[key]) ? (parsed[key] as T[]) : [];
  } catch {
    return [];
  }
};

const engagement = (ctx: Ctx, lines: string[]): string =>
  [
    "## Your engagement",
    "",
    `- runId: ${ctx.runId}`,
    `- cwd: ${ctx.cwd}`,
    `- scope: ${ctx.scope}`,
    `- only tests in the ${ctx.scope} vitest project can kill these mutants; a test in another project does not count`,
    ...lines,
  ].join("\n");

const evaluate = async (ctx: Ctx, run: boolean): Promise<GatesEvaluation> => {
  const gates = await evaluateGates({
    cwd: ctx.cwd,
    runId: ctx.runId,
    ...(run ? { commands: ctx.commands, probe: {} } : {}),
  });
  ctx.host.log(
    `pass ${gates.passNo}: ${Object.entries(gates.predicates)
      .map(([id, value]) => `${id.toUpperCase()}=${value ? "T" : "F"}`)
      .join(" ")}`,
  );
  return gates;
};

const ruleBlock = (rule: ApplicableRule): string =>
  [
    `### ${rule.id} (${rule.severity}): ${rule.statement}`,
    `Why: ${rule.rationale}`,
    `Violated when: ${rule.violates.human}`,
    ...rule.rubric.map((item) => `- ${item.question} Expected: ${item.expects}`),
  ].join("\n");

const rulesText = (rules: readonly ApplicableRule[]): string => {
  const accepted = rules.filter((rule) => rule.acceptance !== null);
  const full = accepted.map(ruleBlock).join("\n\n");
  if (full.length <= RULES_LIMIT) return full;
  return [
    "The rules are too long to inline. Call codex_rule_get on each rule your file triggers.",
    ...accepted.map((rule) => `- ${rule.id} (${rule.severity}): ${rule.statement}`),
  ].join("\n");
};

const prepare = async (host: ForgeHost): Promise<Ctx | string> => {
  const cwd = host.worktree;
  const changed = changedProductionFiles(cwd, host.base);
  if (!host.targets && changed.length === 0) {
    return "No production file changed on this branch, so there is nothing to test.";
  }
  const scope = host.scope ?? scopeFor(changed);
  const { rules } = await rulesFor({ cwd, scope });
  if (!rules.some((rule) => rule.acceptance !== null)) {
    return `This project has no accepted ${scope} codex. Run the rules session for scope ${scope} first.`;
  }
  const focus =
    host.focus ??
    testSurface(host.pack) ??
    (await host.ask(
      "question",
      `The test step for ${host.ticket} needs its focus: what must the tests prove? Write one line per thing. The plan has no "Test surface" section.`,
    ));
  if (!focus?.trim()) return "The test step has no focus, so it cannot open a run.";

  const runId = await openRun(host, cwd, scope, focus);
  const dir = path.join(host.pack, "forge", `run-${runId}`);
  fs.mkdirSync(dir, { recursive: true });
  return {
    host,
    cwd,
    dir,
    scope,
    runId,
    units: [],
    commands: commandsFor(scope),
    ruledTests: new Set(),
    pass: 0,
    mode: host.mode ?? "write",
    baseline: {},
    focus,
    rules: rulesText(rules),
    scopeInfo: undefined,
    eligible: new Set(),
    credited: new Set(),
    refused: new Map(),
    proofs: {},
    emitted: new Map(),
    planned: false,
    inspected: new Map(),
    mapperRan: false,
    failure: undefined,
  };
};

const openRun = async (
  host: ForgeHost,
  cwd: string,
  scope: ForgeScope,
  focus: string,
): Promise<number> => {
  const stored = host.fresh ? undefined : storedRun(host.pack, scope);
  if (stored !== undefined) {
    const snapshot = await state({ cwd, runId: stored });
    if (snapshot.run.exitKind === null) return stored;
    if (snapshot.run.exitKind !== "DONE") {
      await runReopen({ cwd, runId: stored });
      return stored;
    }
  }
  const started = await runStart({ cwd, focus, scope, depth: host.depth });
  storeRun(host.pack, scope, started.runId);
  return started.runId;
};

const readWorktreeFile = (ctx: Ctx) => (file: string): string => {
  try {
    return fs.readFileSync(path.join(ctx.cwd, file), "utf8");
  } catch {
    return "";
  }
};

const persistBaseline = (ctx: Ctx): void => {
  fs.writeFileSync(baselineFile(ctx), JSON.stringify(ctx.baseline, null, 2));
};

const loadBaseline = (ctx: Ctx): void => {
  if (!fs.existsSync(baselineFile(ctx))) return;
  ctx.baseline = JSON.parse(fs.readFileSync(baselineFile(ctx), "utf8")) as TestBaseline;
};

const snapshot = (ctx: Ctx, files: readonly string[]): void => {
  const fresh = files.filter((file) => ctx.baseline[file] === undefined);
  if (fresh.length === 0) return;
  ctx.baseline = { ...ctx.baseline, ...baselineOf(fresh, readWorktreeFile(ctx)) };
  persistBaseline(ctx);
};

const mergeUnits = (ctx: Ctx, incoming: readonly Unit[]): void => {
  for (const unit of incoming) {
    const known = unitForFile(ctx.units, unit.file);
    if (known) {
      known.sources = [...new Set([...known.sources, ...unit.sources])];
    } else {
      ctx.units.push({ file: unit.file, sources: [...unit.sources], rows: [], focusLines: [] });
    }
  }
};

const seedUnits = (ctx: Ctx): void => {
  mergeUnits(
    ctx,
    existingUnits({
      sources: changedProductionFiles(ctx.cwd, ctx.host.base),
      testFiles: worktreeFiles(ctx.cwd),
      scope: ctx.scope,
      read: readWorktreeFile(ctx),
    }),
  );
  const mapped = readUnits(unitsFile(ctx));
  if (typeof mapped !== "string") mergeUnits(ctx, mapped);
};

const mapperTask = (ctx: Ctx, sources: readonly string[]): string =>
  [
    `Name the test file of each production file below for ${ctx.host.ticket}. You write no test.`,
    "",
    engagement(ctx, [
      `- production files without a test file: ${sources.join(", ")}`,
      ...(ctx.host.targets ? [`- targets: ${ctx.host.targets}`] : []),
      `- context pack: ${ctx.host.pack}`,
      `- write the unit list to: ${unitsFile(ctx)}`,
    ]),
  ].join("\n");

const nameTestFiles = async (ctx: Ctx, sources: readonly string[]): Promise<void> => {
  if (sources.length === 0 || ctx.mapperRan || ctx.host.size === "S" || ctx.mode === "harden") return;
  ctx.mapperRan = true;
  const outcome = await ctx.host.spawn({ role: "mapper", name: "map", task: mapperTask(ctx, sources) });
  const failure = mapperFailure(outcome);
  if (failure) {
    ctx.host.log(`mapper: ${failure} The conventional path next to the source is used.`);
    return;
  }
  const units = readUnits(unitsFile(ctx));
  if (typeof units === "string") {
    ctx.host.log(`mapper: ${units}. The conventional path next to the source is used.`);
    return;
  }
  mergeUnits(ctx, units);
};

const openFindingsFor = async (ctx: Ctx, file: string, withRejected: boolean): Promise<string> => {
  const snapshot = await state({ cwd: ctx.cwd, runId: ctx.runId });
  return snapshot.findings
    .filter(
      (finding) =>
        (finding.status === "open" || (withRejected && finding.status === "rejected")) &&
        `${finding.location} ${finding.evidence ?? ""}`.includes(file),
    )
    .map(
      (finding) =>
        `- ${finding.findingKey} [${finding.status}] ${finding.title} at ${finding.location}${finding.proposedFix ? `\n  fix: ${String(finding.proposedFix).slice(0, 600)}` : ""}${finding.evidence ? `\n  evidence: ${String(finding.evidence).slice(0, 800)}` : ""}`,
    )
    .join("\n");
};

const authorTask = (ctx: Ctx, unit: Unit): string =>
  ctx.mode === "harden"
    ? [
        `Harden the existing test file ${unit.file}.`,
        "",
        engagement(ctx, [
          `- your file: ${unit.file}`,
          `- the production code it covers: ${unit.sources.join(", ")}`,
          `- your test command: ${ctx.commands.test} ${unit.file}`,
          `- write your waiver and exemption requests to: ${requestsFile(ctx, unit.file)}`,
          `- write the mutants each test kills to: ${targetsFile(ctx, unit.file)}`,
          "- add tests to this file only to kill the surviving mutants listed in the work items",
          "- never delete, rename, skip or weaken a test listed in protected_tests",
          "- never create a new test file",
        ]),
      ].join("\n")
    : [
        `Write the tests of ${unit.file} so that they kill the mutants in the work items.`,
        "",
        engagement(ctx, [
          `- your file: ${unit.file}${fs.existsSync(path.join(ctx.cwd, unit.file)) ? "" : " (it does not exist yet: create it where the repository keeps tests of this kind)"}`,
          `- the production code it covers: ${unit.sources.join(", ") || "see the work items"}`,
          `- what the tests must prove: ${ctx.focus.split("\n").join("; ")}`,
          `- your test command: ${ctx.commands.test} ${unit.file}`,
          `- write your waiver and exemption requests to: ${requestsFile(ctx, unit.file)}`,
          `- write the mutants each test kills to: ${targetsFile(ctx, unit.file)}`,
          "- never delete, rename, skip or weaken a test listed in protected_tests",
        ]),
      ].join("\n");

const write = async (ctx: Ctx, work: Map<string, string[]>, label: string): Promise<void> => {
  const files = [...work.keys()];
  snapshot(ctx, files);
  await inBatches(files, async (file) => {
    const unit = unitForFile(ctx.units, file);
    if (!unit) return;
    const items = work.get(file) ?? [];
    const findings = await openFindingsFor(ctx, unit.file, items.some((line) => line.startsWith("D4")));
    await ctx.host.spawn({
      role: "test-author",
      name: `${label}:${path.basename(unit.file)}`,
      task: authorTask(ctx, unit),
      parts: [
        tagged("work_items", items.join("\n")),
        tagged("open_findings", findings),
        tagged("protected_tests", protectedTestsOf(ctx.baseline, unit.file).map((name) => `- ${name}`).join("\n")),
        tagged("codex_rules", ctx.rules),
      ],
    });
  });
  await unitUpsertBatch({
    cwd: ctx.cwd,
    runId: ctx.runId,
    units: files.map((file) => ({
      filePath: file,
      authorCallsign: `TEST-AUTHOR-${fileSlug(path.basename(file))}`,
      state: "drafted",
    })),
  });
};

const inspectMechanically = async (
  ctx: Ctx,
  file: string,
  rules: readonly MechanicalRule[],
): Promise<MechanicalRule[]> => {
  const plan = planMechanical(rules);
  if (plan.mechanical.length === 0) return plan.residual;
  const report = astCheckBatch({
    cwd: ctx.cwd,
    filePaths: [file],
    checks: plan.mechanical.map(({ request }) => request),
  }).reports[0];
  const judged = plan.mechanical.map(({ rule }) => ({
    rule,
    judgement: judgeOutcome(
      rule,
      report?.checks.find((outcome) => outcome.checkId === rule.id),
    ),
  }));
  const judgements = judged.flatMap(({ judgement }) => (judgement ? [judgement] : []));
  const unjudged = judged.filter(({ judgement }) => !judgement).map(({ rule }) => rule);
  await recordMechanical(ctx, file, judgements);
  return [...plan.residual, ...unjudged];
};

const recordMechanical = async (
  ctx: Ctx,
  file: string,
  judgements: readonly Judgement[],
): Promise<void> => {
  if (judgements.length === 0) return;
  await verdictRecordBatch({
    cwd: ctx.cwd,
    runId: ctx.runId,
    verdicts: verdictsFor(file, judgements),
  });
  const findings = findingsFor(file, judgements);
  if (findings.length > 0) await findingUpsertBatch({ cwd: ctx.cwd, runId: ctx.runId, findings });
  ctx.host.log(
    `inspect ${file}: ${judgements.length} mechanical verdict(s), ${findings.length} finding(s)`,
  );
};

const inspect = async (ctx: Ctx, files: readonly string[], label: string): Promise<void> => {
  await inBatches(files, async (file) => {
    const found = await rulesFor({ cwd: ctx.cwd, scope: ctx.scope, filePath: file });
    const rules = ctx.host.size === "S" ? await inspectMechanically(ctx, file, found.rules) : found.rules;
    const ids = rules.map((rule) => rule.id);
    if (ids.length === 0) return;
    await ctx.host.spawn({
      role: "inspector",
      name: `${label}:${path.basename(file)}`,
      task: [
        `Judge ${file} against each rule below.`,
        "",
        engagement(ctx, [`- the file: ${file}`, `- the rules: ${ids.join(", ")}`]),
      ].join("\n"),
    });
  });
  const read = readWorktreeFile(ctx);
  for (const file of files) ctx.inspected.set(file, digest(read(file)));
  await unitUpsertBatch({
    cwd: ctx.cwd,
    runId: ctx.runId,
    units: files.map((file) => ({ filePath: file, state: "reviewed" })),
  });
};

const verify = async (ctx: Ctx, items: readonly WorkItem[], label: string): Promise<void> => {
  const before = new Set(
    (await state({ cwd: ctx.cwd, runId: ctx.runId })).findings
      .filter((finding) => finding.status === "confirmed-defect")
      .map((finding) => finding.findingKey),
  );
  await inBatches(items, async (item) => {
    await ctx.host.spawn({
      role: "defect-verifier",
      name: `${label}:${path.basename(item.ref.split("::")[0] ?? item.ref)}`,
      task: [
        "Rule on one red test.",
        "",
        engagement(ctx, [
          `- the red test: ${item.ref}`,
          `- its test command: ${ctx.commands.test} ${item.ref.split("::")[0]}`,
          `- the context pack, for the ticket and the decisions: ${ctx.host.pack}`,
        ]),
      ].join("\n"),
    });
    ctx.ruledTests.add(item.ref);
  });
  if (ctx.host.size === "S") return;
  const confirmed = (await state({ cwd: ctx.cwd, runId: ctx.runId })).findings.filter(
    (finding) => finding.status === "confirmed-defect" && !before.has(finding.findingKey),
  );
  await inBatches(confirmed, async (finding) => {
    await ctx.host.spawn({
      role: "defect-skeptic",
      name: `${label}:${finding.findingKey.slice(0, 40)}`,
      task: [
        "Attack one confirmed defect.",
        "",
        engagement(ctx, [
          `- the finding key: ${finding.findingKey}`,
          `- its location: ${finding.location}`,
          `- the context pack: ${ctx.host.pack}`,
        ]),
      ].join("\n"),
    });
  });
};

const resolveEscalations = async (ctx: Ctx): Promise<void> => {
  const { open } = await escalationOpen({ cwd: ctx.cwd, runId: ctx.runId });
  for (const item of open) {
    const answer = await ctx.host.decide(
      [
        `Test Forge run ${ctx.runId}: ${item.raisedBy} raised an escalation on ${item.subjectKind} ${item.subjectRef}.`,
        "",
        item.claim,
        "",
        `Start the answer with one word: ${RESOLUTIONS.join(", ")}. "waived" leaves the claim unfixed and needs the user. Then give the decision and the reason.`,
      ].join("\n"),
    );
    const word = answer.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z-]/g, "") ?? "";
    const resolution = RESOLUTIONS.find((entry) => entry === word) ?? "fixed";
    if (resolution === "waived") {
      const signature = await ctx.host.ask(
        "sign",
        `Waive escalation ${item.escalationKey} on ${item.subjectRef}? The claim stays unfixed:\n\n${item.claim}\n\nThe proposed reason: ${answer}\n\nReply "approve" to sign, or anything else to leave it open.`,
      );
      if (!signature || !SIGN_ALL.test(signature)) continue;
    }
    await escalationResolve({
      cwd: ctx.cwd,
      runId: ctx.runId,
      escalationKey: item.escalationKey,
      resolution,
      resolvedBy: resolution === "waived" ? USER : "orchestrator",
      reason: answer.slice(0, 2000),
    });
    const unit = unitForFile(ctx.units, item.subjectRef.split("::")[0] ?? item.subjectRef);
    if (unit && resolution === "fixed") {
      await write(ctx, new Map([[unit.file, [`Escalation ${item.escalationKey} was answered: ${answer}`]]]), `answer-${ctx.pass}`);
    }
  }
};

const signRequests = async (ctx: Ctx): Promise<void> => {
  const signed = new Set(
    (await state({ cwd: ctx.cwd, runId: ctx.runId })).waivers.map(
      (waiver) => `${waiver.kind}::${waiver.ref}`,
    ),
  );
  const requests = ctx.units
    .flatMap((unit) => [
      ...readJsonList<Request>(requestsFile(ctx, unit.file), "waivers"),
      ...readJsonList<{ test: string; reason: string }>(requestsFile(ctx, unit.file), "exemptions").map(
        (entry) => ({ kind: "test-value", ref: entry.test, reason: entry.reason }),
      ),
    ])
    .filter((request) => typeof request.ref === "string" && !signed.has(`${request.kind}::${request.ref}`));
  if (requests.length === 0) return;
  const answer = await ctx.host.ask(
    "sign",
    [
      `Test Forge run ${ctx.runId} asks you to sign ${requests.length} waiver(s). Each one leaves the item below unchecked.`,
      "",
      ...requests.map((request) => `- ${request.kind} ${request.ref}: ${request.reason}`),
      "",
      'Reply "approve" to sign them all. Any other reply signs none and sends your words back to the test authors.',
    ].join("\n"),
  );
  if (!answer || !SIGN_ALL.test(answer)) {
    if (answer) {
      for (const unit of ctx.units) fs.rmSync(requestsFile(ctx, unit.file), { force: true });
      const work = new Map(
        ctx.units.map((unit) => [unit.file, [`The user refused the waivers: ${answer}. Cover the refused items, and request again only what the user allowed.`]]),
      );
      await write(ctx, work, `refused-${ctx.pass}`);
    }
    return;
  }
  await waiverRecordBatch({
    cwd: ctx.cwd,
    runId: ctx.runId,
    waivers: requests.filter(isWaiverRequest).map((request) => ({
      kind: request.kind,
      ref: request.ref,
      reason: request.reason,
      signedBy: USER,
    })),
  });
};

const mutants = (ctx: Ctx, outcomes: readonly string[]): Mutant[] =>
  all<Mutant>(
    openDb(),
    `SELECT id, file_path, line, operator, outcome FROM mutants WHERE run_id = ? AND outcome IN (${outcomes.map(() => "?").join(", ")}) ORDER BY file_path, line`,
    [ctx.runId, ...outcomes],
  );

const claimRows = (ids: readonly number[]): Claim[] =>
  ids.length === 0
    ? []
    : all<Claim>(
        openDb(),
        `SELECT mutant_id, claimed_by, argument FROM equivalence_claims WHERE mutant_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
        [...ids],
      );

const publishPlan = (ctx: Ctx, rows: readonly LedgerMutant[]): void => {
  if (ctx.planned || rows.length === 0) return;
  ctx.host.event("mutant_plan", `planned ${rows.length} mutants`, { mutants: rows.map(plannedOfLedger) });
  ctx.planned = true;
};

const publishTested = (ctx: Ctx, tested: TestedMutant): void => {
  const event = eventOfLedger(
    {
      id: tested.id,
      file: tested.site.file,
      line: tested.site.start.line,
      mutator: tested.site.mutator,
      original: tested.originalText,
      replacement: tested.site.replacement,
      outcome: tested.outcome,
      killedBy: [],
    },
    0,
  );
  ctx.host.event("mutant", `mutant ${tested.id} ${event.status}`, { ...event });
};

const publish = (ctx: Ctx): void => {
  const rows = ledgerMutants(ctx.runId);
  publishPlan(ctx, rows);
  for (const row of rows) {
    if (row.outcome === "pending" || ctx.emitted.get(row.id) === row.outcome) continue;
    ctx.emitted.set(row.id, row.outcome);
    const event = eventOfLedger(row, 0);
    ctx.host.event("mutant", `mutant ${row.id} ${event.status}`, { ...event });
  }
};

const countsText = (rows: readonly LedgerMutant[]): string => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.outcome, (counts.get(row.outcome) ?? 0) + 1);
  return [...counts.entries()].map(([outcome, count]) => `${outcome} ${count}`).join(", ");
};

const passTestFiles = (ctx: Ctx): string[] =>
  [...new Set(ctx.units.map((unit) => unit.file))]
    .filter((file) => fs.existsSync(path.join(ctx.cwd, file)))
    .sort();

const runPass = async (ctx: Ctx, label: string): Promise<string | undefined> => {
  if (ctx.host.stopped()) return "The run was stopped.";
  ctx.host.log(`mutation ${label}: Stryker runs`);
  const result: MutationPassResult = await mutationPass({
    cwd: ctx.cwd,
    base: ctx.host.base,
    runId: ctx.runId,
    files: changedProductionFiles(ctx.cwd, ctx.host.base).filter((file) => projectKindOf(file) === ctx.scope),
    testFiles: passTestFiles(ctx),
    label: `${ctx.runId}-${label}`,
    keepHarness: true,
    onPlanned: () => publishPlan(ctx, ledgerMutants(ctx.runId)),
    onMutantTested: (tested) => publishTested(ctx, tested),
  });
  if (!result.ok) return `The mutation pass ${label} failed: ${result.reason}`;
  publish(ctx);
  ctx.host.log(
    `mutation ${label}: ${result.reconciliation.inScopeInLedger} in scope, ${countsText(ledgerMutants(ctx.runId))}, ${Math.round(result.totalMs / 1000)} s`,
  );
  return undefined;
};

const NEEDS_TEST: ReadonlySet<string> = new Set(["survived", "no_coverage", "refuted"]);

const needingTest = (ctx: Ctx): LedgerMutant[] =>
  ledgerMutants(ctx.runId).filter((mutant) => NEEDS_TEST.has(mutant.outcome));

const recheckOpen = async (ctx: Ctx, label: string, touched: readonly string[]): Promise<string | undefined> => {
  if (ctx.host.stopped()) return "The run was stopped.";
  const open = new Set(needingTest(ctx).map((mutant) => mutant.id));
  const jobs = strykerRowsOf(openDb(), ctx.runId)
    .filter((row) => open.has(row.id))
    .map((row) => {
      const job = jobOf(row);
      const added = touched.filter((file) => projectKindOf(file) === job.kind);
      return { ...job, row: { ...row, coveredBy: [] }, testFiles: [...new Set([...job.testFiles, ...added])].sort() };
    })
    .filter((job) => job.testFiles.length > 0);
  if (jobs.length === 0) return undefined;
  ctx.host.log(`re-check ${label}: ${jobs.length} open mutant(s) run`);
  const startedAt = Date.now();
  const batch = await runSoloJobs({ cwd: ctx.cwd, runId: ctx.runId }, jobs);
  if (!batch.ok) return `The re-check ${label} failed: ${batch.reason}`;
  publish(ctx);
  ctx.host.log(
    `re-check ${label}: ${jobs.length} open mutant(s), ${countsText(ledgerMutants(ctx.runId))}, ${Math.round((Date.now() - startedAt) / 1000)} s`,
  );
  return undefined;
};

const INITIAL_RUN_FAILED = /failed tests in the initial test run/i;

const failingTestWork = async (ctx: Ctx): Promise<Map<string, string[]>> => {
  const run = await execSuite({ cwd: ctx.cwd, command: ctx.commands.test, files: passTestFiles(ctx) });
  const work = new Map<string, string[]>();
  for (const failure of run.failures) {
    addLines(work, path.relative(ctx.cwd, path.resolve(ctx.cwd, failure.file)), [
      `The test "${failure.testName}" fails on the unchanged production code, so the mutation baseline cannot start. Fix the test, not the production code. Failure: ${failure.message.slice(0, 400)}`,
    ]);
  }
  return work;
};

const runBaseline = async (ctx: Ctx): Promise<string | undefined> => {
  let failingBefore = Number.POSITIVE_INFINITY;
  for (let attempt = 1; ; attempt += 1) {
    const failure = await runPass(ctx, attempt === 1 ? "baseline" : `baseline-${attempt}`);
    if (!failure || !INITIAL_RUN_FAILED.test(failure)) return failure;
    const work = await failingTestWork(ctx);
    if (work.size === 0 || work.size >= failingBefore) return failure;
    failingBefore = work.size;
    await write(ctx, work, `repair-${attempt}`);
  }
};

const productionDigest = (ctx: Ctx): string => {
  const read = readWorktreeFile(ctx);
  return digest(
    changedProductionFiles(ctx.cwd, ctx.host.base)
      .map((file) => `${file}\n${read(file)}`)
      .join("\n"),
  );
};

const writeProofs = (ctx: Ctx): void => {
  fs.writeFileSync(proofsFile(ctx), JSON.stringify(ctx.proofs, null, 2));
};

const soloVerify = async (
  ctx: Ctx,
  pending: readonly GateOutcome[],
  rows: readonly LedgerMutant[],
): Promise<Map<string, number[]>> => {
  const verified = new Map<string, number[]>();
  if (pending.length === 0) return verified;
  const known = new Map(strykerRowsOf(openDb(), ctx.runId).map((row) => [row.id, row]));
  const jobs = pending.flatMap((outcome) =>
    outcome.verify.flatMap((id) => {
      const row = known.get(id);
      return row
        ? [
            {
              key: testKeyOf(outcome.test),
              id,
              job: jobOf({
                ...row,
                coveredBy: [{ file: outcome.test.file, name: fullNameOf(outcome.test, rows) }],
              }),
            },
          ]
        : [];
    }),
  );
  if (jobs.length === 0) return verified;
  const batch = await runSoloJobs({ cwd: ctx.cwd, runId: ctx.runId, record: false }, jobs.map(({ job }) => job));
  if (!batch.ok) {
    ctx.host.log(`kill gate: the solo check did not run: ${batch.reason}`);
    return verified;
  }
  jobs.forEach(({ key, id }, index) => {
    const result = batch.results[index];
    if (result && KILLED_OUTCOMES.has(result.outcome)) verified.set(key, [...(verified.get(key) ?? []), id]);
  });
  return verified;
};

const hintFor = (ctx: Ctx, test: { file: string; targets: number[] }, rows: readonly LedgerMutant[]): number[] => {
  const targeted = test.targets.filter((id) => rows.some((row) => row.id === id && ctx.eligible.has(id)));
  if (targeted.length > 0) return targeted;
  const open = assignMutants({
    mutants: openMutants(rows),
    units: ctx.units,
    restrictToUnits: ctx.mode === "harden",
    newFileFor: (source) => unitFileFor(ctx, source),
  });
  return (open.byFile.get(test.file) ?? []).slice(0, 6).map((mutant) => mutant.id);
};

const gate = async (ctx: Ctx, files: readonly string[]): Promise<void> => {
  const read = readWorktreeFile(ctx);
  for (const [key, refusal] of ctx.refused) {
    if (files.includes(refusal.file)) ctx.refused.delete(key);
  }
  const tests = files
    .flatMap((file) =>
      newTestsOf({
        baseline: ctx.baseline,
        file,
        content: read(file),
        targets: readTargets(targetsFile(ctx, file)),
      }),
    )
    .filter((test) => !ctx.credited.has(testKeyOf(test)));
  if (tests.length === 0) return;
  const rows = ledgerMutants(ctx.runId);
  const outcomes = gateTests({ eligible: ctx.eligible, mutants: rows, tests });
  const verified = await soloVerify(
    ctx,
    outcomes.filter((outcome) => outcome.killed.length === 0 && outcome.verify.length > 0),
    rows,
  );
  for (const outcome of outcomes) {
    const key = testKeyOf(outcome.test);
    const killed = outcome.killed.length > 0 ? outcome.killed : (verified.get(key) ?? []);
    if (killed.length > 0) {
      ctx.credited.add(key);
      ctx.proofs[key] = killed;
    } else {
      ctx.refused.set(key, {
        file: outcome.test.file,
        line: refusalLine(outcome.test, hintFor(ctx, outcome.test, rows)),
      });
    }
  }
  writeProofs(ctx);
  ctx.host.log(
    `kill gate: ${tests.length} new test(s), ${tests.filter((test) => ctx.credited.has(testKeyOf(test))).length} credited, ${ctx.refused.size} refused`,
  );
};

const refusalWork = (ctx: Ctx): Map<string, string[]> => {
  const work = new Map<string, string[]>();
  for (const refusal of ctx.refused.values()) addLines(work, refusal.file, [refusal.line]);
  return work;
};

const unitFileFor = (ctx: Ctx, source: string): string =>
  ctx.units.find((unit) => unit.sources.includes(source))?.file ?? fallbackTestPath(source);

const mutantWork = async (
  ctx: Ctx,
  targets: readonly LedgerMutant[],
  hints: ReadonlyMap<number, string>,
): Promise<Map<string, string[]>> => {
  await nameTestFiles(ctx, sourcesWithoutTestFile(targets, ctx.units));
  const assignment = assignMutants({
    mutants: targets,
    units: ctx.units,
    restrictToUnits: ctx.mode === "harden",
    newFileFor: (source) => unitFileFor(ctx, source),
  });
  for (const [file, sources] of assignment.newFiles) {
    mergeUnits(ctx, [{ file, sources, rows: [], focusLines: [] }]);
  }
  for (const [file, group] of assignment.byFile) {
    mergeUnits(ctx, [{ file, sources: group.map((mutant) => mutant.file), rows: [], focusLines: [] }]);
  }
  if (assignment.unassigned.length > 0) {
    ctx.host.log(`harden: ${assignment.unassigned.length} mutant(s) have no existing test file to extend`);
  }
  const work = new Map<string, string[]>();
  for (const [file, group] of assignment.byFile) {
    addLines(work, file, group.map((mutant) => mutantLine(mutant, hints.get(mutant.id))));
  }
  return work;
};

const killRound = async (
  ctx: Ctx,
  label: string,
  work: Map<string, string[]>,
): Promise<string | undefined> => {
  if (ctx.host.stopped()) return "The run was stopped.";
  await write(ctx, work, label);
  const lost = await restoreProtected(ctx);
  if (lost) return lost;
  const files = [...work.keys()];
  const failure = await recheckOpen(ctx, label, files);
  if (failure) return failure;
  await gate(ctx, files);
  return undefined;
};

const huntSurvivors = async (ctx: Ctx, round: number): Promise<Map<string, string[]>> => {
  const survived = mutants(ctx, ["survived", "no_coverage"]);
  const rows = new Map(ledgerMutants(ctx.runId).map((row) => [row.id, row]));
  await inBatches([...groupBy(survived, (mutant) => mutant.file_path)], async ([source, group]) => {
    await ctx.host.spawn({
      role: "survivor-analyst",
      name: `survivors-${round}:${path.basename(source)}`,
      task: [
        `Analyse the surviving mutants of ${source}.`,
        "",
        engagement(ctx, [
          `- the production file: ${source}`,
          `- the mutant ids: ${group.map((mutant) => mutant.id).join(", ")}`,
          `- write the coverage holes to: ${holesFile(ctx, source)}`,
        ]),
      ].join("\n"),
      parts: [
        tagged(
          "mutants",
          group.flatMap((mutant) => (rows.get(mutant.id) ? [mutantLine(rows.get(mutant.id) as LedgerMutant)] : [])).join("\n"),
        ),
      ],
    });
  });
  const claimed = mutants(ctx, ["equivalent-claimed"]);
  await inBatches([...groupBy(claimed, (mutant) => mutant.file_path)], async ([source, group]) => {
    await ctx.host.spawn({
      role: "equivalence-hunter",
      name: `claims-${round}:${path.basename(source)}`,
      task: [
        `Try to refute each equivalence claim on ${source}.`,
        "",
        engagement(ctx, [
          `- the production file: ${source}`,
          `- the claimed mutant ids: ${group.map((mutant) => mutant.id).join(", ")}`,
        ]),
      ].join("\n"),
    });
  });

  const hints = new Map<number, string>();
  for (const source of new Set(survived.map((mutant) => mutant.file_path))) {
    for (const hole of readJsonList<{ mutantId: number; test: string }>(holesFile(ctx, source), "holes")) {
      hints.set(hole.mutantId, hole.test);
    }
  }
  const refuted = mutants(ctx, ["refuted"]);
  const refutations = all<{ mutant_id: number; refutation: string }>(
    openDb(),
    `SELECT mutant_id, refutation FROM equivalence_claims WHERE refuted_by IS NOT NULL AND mutant_id IN (${refuted.map(() => "?").join(", ") || "NULL"})`,
    refuted.map((mutant) => mutant.id),
  );
  for (const mutant of refuted) {
    const text = refutations.find((entry) => entry.mutant_id === mutant.id)?.refutation ?? "";
    hints.set(mutant.id, `not equivalent: ${text.slice(0, 600)}`);
  }
  const targets = [...hints.keys()].flatMap((id) => {
    const row = rows.get(id);
    return row ? [row] : [];
  });
  return mutantWork(ctx, targets, hints);
};

const signEquivalences = async (ctx: Ctx): Promise<void> => {
  const pending = mutants(ctx, ["equivalent-claimed"]);
  const claims = claimRows(pending.map((mutant) => mutant.id));
  if (claims.length === 0) return;
  const rows = new Map(ledgerMutants(ctx.runId).map((row) => [row.id, row]));
  const answer = await ctx.host.ask(
    "sign",
    [
      `Test Forge run ${ctx.runId}: ${claims.length} mutant(s) survived, and the hunter could not refute their equivalence claims. Signing says no input can show a difference between them and the real code, a throw included.`,
      "",
      ...claims.map((claim) => {
        const row = rows.get(claim.mutant_id);
        return `- mutant ${claim.mutant_id}${row ? ` ${spanOf(row)} ${row.mutator}` : ""}: ${claim.argument.slice(0, 500)}`;
      }),
      "",
      'Reply "approve" to sign them all. Any other reply signs none.',
    ].join("\n"),
  );
  if (!answer || !SIGN_ALL.test(answer)) return;
  for (const claim of claims) {
    await mutationEquivalenceRecord({
      cwd: ctx.cwd,
      mutantId: claim.mutant_id,
      claimedBy: claim.claimed_by,
      argument: claim.argument,
      upheld: true,
      signedBy: USER,
    });
  }
  publish(ctx);
};

const mutationStage = async (ctx: Ctx): Promise<string | undefined> => {
  const current = productionDigest(ctx);
  const reusable =
    ledgerMutants(ctx.runId).length > 0 &&
    fs.existsSync(baselineDigestFile(ctx)) &&
    fs.readFileSync(baselineDigestFile(ctx), "utf8") === current;
  if (!reusable) {
    const baseline = await runBaseline(ctx);
    if (baseline) return baseline;
    fs.writeFileSync(baselineDigestFile(ctx), current);
  }
  const first = ledgerMutants(ctx.runId);
  if (first.length === 0) return "No mutant could be generated on the changed lines.";
  ctx.eligible = fs.existsSync(eligibleFile(ctx))
    ? new Set(readJsonList<number>(eligibleFile(ctx), "ids"))
    : new Set(openMutants(first).map((mutant) => mutant.id));
  fs.writeFileSync(eligibleFile(ctx), JSON.stringify({ ids: [...ctx.eligible] }));
  ctx.host.log(`mutation baseline: ${first.length} in scope, ${ctx.eligible.size} open`);

  const openCount = (): number => needingTest(ctx).length;

  const uncovered = openMutants(ledgerMutants(ctx.runId)).filter((mutant) => mutant.outcome === "no_coverage");
  if (uncovered.length > 0) {
    ctx.pass += 1;
    const work = await mutantWork(ctx, uncovered, new Map());
    for (const [file, lines] of refusalWork(ctx)) addLines(work, file, lines);
    const failure = work.size > 0 ? await killRound(ctx, "cover", work) : undefined;
    if (failure) return failure;
  }

  for (let round = 1, before = openCount(); ; round += 1) {
    ctx.pass += 1;
    const work = await huntSurvivors(ctx, round);
    for (const [file, lines] of refusalWork(ctx)) addLines(work, file, lines);
    if (work.size === 0) break;
    const failure = await killRound(ctx, `hole-${round}`, work);
    if (failure) return failure;
    const after = openCount();
    if (after >= before) break;
    before = after;
  }
  await signEquivalences(ctx);
  return undefined;
};

const restoreProtected = async (ctx: Ctx): Promise<string | undefined> => {
  const read = readWorktreeFile(ctx);
  const removed = removedProtectedTests(ctx.baseline, read);
  if (removed.length === 0) return undefined;
  await write(
    ctx,
    new Map(
      removed.map(({ file, names }) => [
        file,
        [`Restore these tests that existed before the run and were removed: ${names.join("; ")}`],
      ]),
    ),
    "restore",
  );
  const still = removedProtectedTests(ctx.baseline, read);
  return still.length === 0
    ? undefined
    : `Tests that existed before the run are gone: ${still.map(({ file, names }) => `${file} (${names.join("; ")})`).join(", ")}`;
};

const finish = async (ctx: Ctx): Promise<GatesEvaluation | undefined> => {
  const read = readWorktreeFile(ctx);
  let gates: GatesEvaluation | undefined;
  let previousWork = Number.POSITIVE_INFINITY;
  for (let attempt = 1; ; attempt += 1) {
    const changed = changedTestFiles(ctx.baseline, read);
    if (changed.length === 0) return gates;
    mergeUnits(ctx, changed.map((file) => ({ file, sources: [], rows: [], focusLines: [] })));
    await unitUpsertBatch({
      cwd: ctx.cwd,
      runId: ctx.runId,
      units: changed.map((file) => ({ filePath: file, state: "drafted" })),
    });
    gates = await evaluate(ctx, true);
    const fresh = changed.filter((file) => ctx.inspected.get(file) !== digest(read(file)));
    if (fresh.length > 0) {
      await inspect(ctx, fresh, `inspect-${attempt}`);
      gates = await evaluate(ctx, false);
    }
    const toVerify = routeWork(ctx.units, gates.workList, ctx.ruledTests).verify;
    if (toVerify.length > 0) {
      await verify(ctx, toVerify, `verify-${attempt}`);
      gates = await evaluate(ctx, false);
    }
    await resolveEscalations(ctx);
    await signRequests(ctx);
    gates = await evaluate(ctx, false);
    const pending = gates.workList.filter((item) => FIXABLE.includes(item.predicate));
    const work = routeWork(ctx.units, pending, ctx.ruledTests).byFile;
    if (work.size === 0 || work.size >= previousWork) return gates;
    previousWork = work.size;
    ctx.pass += 1;
    ctx.failure = await killRound(ctx, `polish-${attempt}`, work);
    if (ctx.failure) return gates;
  }
};

const strykerVersion = (): string => {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(here, "..", "..", "test-forge", "packages", "mcp", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    return manifest.dependencies?.["@stryker-mutator/core"] ?? "unknown";
  } catch {
    return "unknown";
  }
};

const writeReport = (ctx: Ctx, blocker: string | undefined): void => {
  const info = ctx.scopeInfo;
  const rows = ledgerMutants(ctx.runId);
  if (!info || rows.length === 0) return;
  fs.writeFileSync(
    reportFile(ctx),
    renderMutationReport({
      ticket: ctx.host.ticket,
      runId: ctx.runId,
      scope: ctx.scope,
      worktree: info.root,
      base: ctx.host.base,
      baseRef: info.baseRef,
      mergeBase: info.mergeBase,
      scopeRule: info.scopeRule,
      changed: Object.fromEntries(info.files.map((file) => [file, info.changed[file] ?? []])),
      stryker: {
        version: strykerVersion(),
        concurrency: strykerConcurrency(cpus().length),
        timeoutFactor: TIMEOUT_FACTOR,
        timeoutMs: TIMEOUT_MS,
      },
      mutants: rows,
      outOfScope: outOfScopeCount(ctx.runId),
      claims: claimsOf(rows.map((row) => row.id)),
      proofs: ctx.proofs,
      refused: [...ctx.refused.keys()],
      blocker,
    }),
  );
  ctx.host.log(`mutation report: ${reportFile(ctx)}`);
};

const listOf = (items: readonly string[]): string =>
  `${items.slice(0, LIST_LIMIT).join(", ")}${items.length > LIST_LIMIT ? `, and ${items.length - LIST_LIMIT} more` : ""}`;

const finalBlocker = (ctx: Ctx): string | undefined => {
  const unresolved = unresolvedMutants(ledgerMutants(ctx.runId));
  return (
    [
      ctx.failure,
      unresolved.length > 0
        ? `${unresolved.length} in-scope mutant(s) have no final state: ${listOf(unresolved.map((mutant) => `M${mutant.id} ${spanOf(mutant)} ${mutant.mutator} ${mutant.outcome}`))}`
        : undefined,
      ctx.refused.size > 0
        ? `${ctx.refused.size} new test(s) kill no mutant: ${listOf([...ctx.refused.keys()])}`
        : undefined,
    ]
      .filter(Boolean)
      .join("; ") || undefined
  );
};

const close = async (
  ctx: Ctx,
  options: { blocker?: string; gates?: GatesEvaluation } = {},
): Promise<ForgeResult> => {
  await resolveEscalations(ctx);
  const { blocker, gates } = options;
  const vacuous: ExitDecision = {
    exitKind: blocker === undefined ? "DONE" : "BLOCKED",
    failing: [],
    notUsed: [],
  };
  const decision = gates
    ? mutationExitDecision({
        predicates: gates.predicates,
        stalled: gates.stalled,
        hasBlocker: blocker !== undefined,
      })
    : vacuous;
  const mutantCounts = countsText(ledgerMutants(ctx.runId));
  const reason =
    decision.exitKind === "DONE"
      ? [
          gates ? "every counted predicate holds" : "no test file changed and every in-scope mutant has a final state",
          mutantCounts ? `mutants: ${mutantCounts}` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : [
          blocker,
          `failing: ${decision.failing.join(", ") || "none"}`,
          mutantCounts ? `mutants: ${mutantCounts}` : "",
          ...(gates?.workList ?? [])
            .filter((item) => FIXABLE.includes(item.predicate))
            .slice(0, 8)
            .map((item) => `${item.predicate} ${item.ref}: ${item.reason}`),
        ]
          .filter(Boolean)
          .join("; ");
  writeReport(ctx, blocker);
  await runEnd({ cwd: ctx.cwd, runId: ctx.runId, exitKind: decision.exitKind, exitReason: reason });
  const defects = (await state({ cwd: ctx.cwd, runId: ctx.runId })).findings
    .filter((finding) => finding.status === "confirmed-defect")
    .map((finding) => ({ findingKey: finding.findingKey, title: finding.title }));
  return {
    status: decision.exitKind === "DONE" ? "done" : "escalated",
    summary: `Test Forge run ${ctx.runId} (${ctx.scope}, ${ctx.host.depth}) ${decision.exitKind}: ${reason}. ${defects.length} confirmed defect(s) for the builder.`,
    runId: ctx.runId,
    scope: ctx.scope,
    defects,
  };
};

const flow = async (ctx: Ctx): Promise<ForgeResult> => {
  const resolved = await resolveScope({ cwd: ctx.cwd, base: ctx.host.base });
  if (!resolved.ok) return close(ctx, { blocker: `The mutation scope could not be set: ${resolved.reason}` });
  ctx.scopeInfo = {
    root: resolved.root,
    changed: resolved.changed,
    files: resolved.selections.flatMap((selection) => selection.files),
    baseRef: resolved.baseRef,
    mergeBase: resolved.mergeBase,
    scopeRule: resolved.scopeRule,
  };
  loadBaseline(ctx);
  seedUnits(ctx);
  if (ctx.mode === "harden" && ctx.units.length === 0) {
    return close(ctx, {
      blocker: "No existing usecase-level test imports a changed production file. Run the write mode.",
    });
  }
  snapshot(ctx, ctx.units.map((unit) => unit.file));
  ctx.host.log(`${ctx.mode}: ${ctx.units.length} test file(s) already pair with the changed code`);

  const needsHarness = resolved.selections.some(
    (selection) => selection.kind === "backend" && selection.inScope.length > 0,
  );
  let started = false;
  const cancelShutdown = onShutdown(() =>
    Promise.allSettled([
      harnessStop({ cwd: resolved.root, drainTimeoutMs: 30_000 }),
      runEnd({ cwd: ctx.cwd, runId: ctx.runId, exitKind: "BLOCKED", exitReason: "the engine process was stopped" }),
    ]),
  );
  if (needsHarness) {
    const booted = await harnessStart({ cwd: resolved.root });
    if (!booted.ok) return close(ctx, { blocker: `The test harness did not start: ${booted.reason}` });
    started = !booted.reused;
    ctx.commands = { ...ctx.commands, test: ATTACHED_BACKEND_TEST };
  }
  try {
    const blocker = await mutationStage(ctx);
    if (blocker) return close(ctx, { blocker });
    const gates = await finish(ctx);
    return close(ctx, { blocker: finalBlocker(ctx), gates });
  } finally {
    cancelShutdown();
    if (started) await harnessStop({ cwd: resolved.root });
  }
};

export const runForge = async (host: ForgeHost): Promise<ForgeResult> => {
  const prepared = await prepare(host);
  if (typeof prepared === "string") {
    host.log(prepared);
    return { status: "escalated", summary: `refused: ${prepared}`, runId: null, scope: null, defects: [], refusal: prepared };
  }
  const ctx = prepared;
  host.log(`Test Forge run ${ctx.runId} (${ctx.scope}, ${host.depth}, ${ctx.mode})`);
  return flow(ctx);
};
