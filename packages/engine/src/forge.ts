import fs from "node:fs";
import path from "node:path";
import type { PredicateId, WorkItem } from "test-forge-contracts/gates";
import { astCheckBatch } from "test-forge-mcp-server/src/application/analysis/check-batch.ts";
import { rulesFor } from "test-forge-mcp-server/src/application/codex/rules-for.ts";
import { closureUnresolved } from "test-forge-mcp-server/src/application/closure/unresolved.ts";
import { campaignStart } from "test-forge-mcp-server/src/application/campaign/start.ts";
import { campaignStop } from "test-forge-mcp-server/src/application/campaign/stop.ts";
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
import { mutationBatchRun } from "test-forge-mcp-server/src/application/mutation/batch-run.ts";
import { mutationEquivalenceRecord } from "test-forge-mcp-server/src/application/mutation/equivalence-record.ts";
import { mutationGenerate } from "test-forge-mcp-server/src/application/mutation/generate.ts";
import { mutationSurvivors } from "test-forge-mcp-server/src/application/mutation/survivors.ts";
import { all, openDb } from "test-forge-mcp-server/src/infrastructure/db/connection.ts";
import {
  changedProductionFiles,
  changedRanges,
  fileSlug,
  readUnits,
  routeWork,
  scopeFor,
  storedRun,
  storeRun,
  testSurface,
  unitForFile,
  unitsForSource,
  worktreeFiles,
  type ForgeScope,
  type Unit,
} from "./forge-units.ts";
import {
  baselineOf,
  changedTestFiles,
  existingUnits,
  exitDecision,
  mapperFailure,
  protectedTestsOf,
  removedProtectedTests,
  type TestBaseline,
} from "./forge-harden.ts";
import { planGatePayload, type PlanGatePayload, type TestMode } from "./gate-payload.ts";
import {
  findingsFor,
  judgeOutcome,
  planMechanical,
  verdictsFor,
  type Judgement,
  type MechanicalRule,
} from "./forge-mechanical.ts";
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
  log: (line: string) => void;
};

export type ForgeResult = {
  status: "done" | "escalated";
  summary: string;
  runId: number | null;
  scope: ForgeScope | null;
  defects: ForgeDefect[];
  refusal?: string;
};

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
};

type Mutant = { id: number; file_path: string; line: number; operator: string; outcome: string };

type Claim = { mutant_id: number; claimed_by: string; argument: string };

type Request = { kind: string; ref: string; reason: string };

type WaiverKind = (typeof WAIVER_KINDS)[number];

const isWaiverRequest = (request: Request): request is Request & { kind: WaiverKind } =>
  WAIVER_KINDS.some((kind) => kind === request.kind);

const CONCURRENCY = 3;
const MAX_ROUNDS = 4;
const MAX_PLAN_REVISIONS = 3;
const MAX_MUTATION_ROUNDS = 2;
const USER = "user";
const SMALL_UNIT_LIMIT = 2;

const APPROVE = /^\s*(approve|approved|yes|y|ok|go|continue)\b/i;
const STOP = /^\s*stop\b/i;
const SIGN_ALL = /^\s*(approve|approved|yes|ok)(\s+(them\s+)?all)?[.!]?\s*$/i;
const RESOLUTIONS = ["fixed", "rule-changed", "rejected", "waived"] as const;
const SETTLED_LATER: readonly PredicateId[] = ["D5", "D6", "D8", "D10"];

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

const commandsFor = (scope: ForgeScope): GateCommands => ({
  test:
    scope === "backend"
      ? "NODE_OPTIONS='--max-old-space-size=8192' yarn vitest run --project backend"
      : "NODE_OPTIONS='--max-old-space-size=4096' yarn vitest run --project frontend",
  typecheck: "NODE_OPTIONS='--max-old-space-size=10240' yarn tsc",
  lint: "yarn lint",
});

const unitsFile = (ctx: Ctx): string => path.join(ctx.dir, "units.json");
const contractFile = (ctx: Ctx): string => path.join(ctx.dir, "contract.md");
const approvedFile = (ctx: Ctx): string => path.join(ctx.dir, "plan-approved.txt");
const requestsFile = (ctx: Ctx, file: string): string =>
  path.join(ctx.dir, `requests-${fileSlug(file)}.json`);
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

const mapperTask = (ctx: Ctx): string =>
  [
    `Map the change for ${ctx.host.ticket} and plan its tests.`,
    "",
    engagement(ctx, [
      ctx.host.targets
        ? `- targets: ${ctx.host.targets}`
        : `- targets: the production files changed against origin/${ctx.host.base}: ${changedProductionFiles(ctx.cwd, ctx.host.base).join(", ")}`,
      `- context pack: ${ctx.host.pack}`,
      `- write the unit contract to: ${contractFile(ctx)}`,
      `- write the unit list to: ${unitsFile(ctx)}`,
    ]),
  ].join("\n");

const planRadius = async (ctx: Ctx): Promise<{ total: number; unresolved: number }> => {
  const radius = await closureUnresolved({ cwd: ctx.cwd, runId: ctx.runId });
  return { total: radius.totalNodes, unresolved: radius.unresolvedCount };
};

const planCard = async (ctx: Ctx): Promise<string> => {
  const radius = await closureUnresolved({ cwd: ctx.cwd, runId: ctx.runId });
  const rows = ctx.units.reduce((sum, unit) => sum + unit.rows.length, 0);
  const full = ctx.host.depth === "full";
  return [
    `Test plan for ${ctx.host.ticket} — Test Forge run ${ctx.runId} (${ctx.scope}, ${ctx.host.depth})`,
    "",
    `Contract: ${contractFile(ctx)}`,
    `Units: ${ctx.units.length} test files, ${rows} matrix rows`,
    ...ctx.units.map(
      (unit) =>
        `- ${unit.file} — ${unit.rows.length} rows, focus lines ${unit.focusLines.join(", ") || "none"}, covers ${unit.sources.join(", ") || "-"}`,
    ),
    `Radius: ${radius.totalNodes} closure nodes, ${radius.unresolvedCount} unresolved. This is what the change reaches; narrowing it is your call.`,
    "",
    `Agents: ${ctx.units.length} test authors + ${ctx.host.size === "S" ? "inspectors only for rules a check cannot decide" : `${ctx.units.length} inspectors`} + 1 verifier per red test + 1 skeptic per confirmed defect${full ? " + 1 survivor analyst per mutated file + 1 equivalence hunter per file with claims" : ""}.`,
    full
      ? "Depth full: mutants run on the changed lines only, then tests with no unique kill are pruned."
      : "Depth quick: no mutation and no pruning.",
  ].join("\n");
};

const map = async (ctx: Ctx): Promise<string | undefined> => {
  let notes = "";
  for (let attempt = 1; attempt <= MAX_PLAN_REVISIONS; attempt += 1) {
    if (notes || !fs.existsSync(unitsFile(ctx))) {
      const outcome = await ctx.host.spawn({
        role: "mapper",
        name: attempt > 1 ? `map#${attempt}` : "map",
        task: mapperTask(ctx),
        parts: [tagged("human_notes", notes)],
      });
      const failure = mapperFailure(outcome);
      if (failure) return failure;
    }
    const units = readUnits(unitsFile(ctx));
    if (typeof units === "string") return `The mapper wrote no valid unit list: ${units}`;
    ctx.units = units;
    await unitUpsertBatch({
      cwd: ctx.cwd,
      runId: ctx.runId,
      units: units.map((unit) => ({
        filePath: unit.file,
        authorCallsign: `TEST-AUTHOR-${fileSlug(path.basename(unit.file))}`,
        state: "assigned",
      })),
    });
    if (fs.existsSync(approvedFile(ctx))) return undefined;
    if (ctx.host.size === "S" && units.length <= SMALL_UNIT_LIMIT) {
      fs.writeFileSync(approvedFile(ctx), "size S: small unit list");
      ctx.host.log(`test plan gate skipped: size S with ${units.length} unit(s)`);
      return undefined;
    }
    const payload = planGatePayload({
      ticket: ctx.host.ticket,
      runId: ctx.runId,
      scope: ctx.scope,
      mode: ctx.mode,
      depth: ctx.host.depth,
      size: ctx.host.size ?? null,
      contract: contractFile(ctx),
      units,
      radius: await planRadius(ctx),
      mapperDelivered: true,
    });
    const answer = await ctx.host.ask(
      "gate",
      `${await planCard(ctx)}\n\n---\nReply "approve" to write the tests, "stop" to end the test step here, or write what must change in the plan.`,
      payload,
    );
    if (!answer) return "No answer at the test plan gate.";
    if (STOP.test(answer)) return "The user stopped the test step at the test plan.";
    if (APPROVE.test(answer)) {
      fs.writeFileSync(approvedFile(ctx), answer);
      return undefined;
    }
    notes = answer;
  }
  return `The test plan reached ${MAX_PLAN_REVISIONS} revisions without approval.`;
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
          `- the codex rules to read: call codex_rule_get on each rule of scope ${ctx.scope} your file triggers`,
          `- your test command: ${ctx.commands.test} ${unit.file}`,
          `- write your waiver and exemption requests to: ${requestsFile(ctx, unit.file)}`,
          "- add tests to this file only to kill the surviving mutants listed in the work items",
          "- never delete, rename, skip or weaken a test listed in protected_tests",
          "- never create a new test file",
        ]),
      ].join("\n")
    : [
        `Write and finish the test file ${unit.file}.`,
        "",
        engagement(ctx, [
          `- your file: ${unit.file}`,
          `- the production code it covers: ${unit.sources.join(", ") || "see the contract"}`,
          `- the unit contract: ${contractFile(ctx)}`,
          `- your matrix rows: ${unit.rows.map((row) => `${row.matrixKey}|${row.rowKey}`).join(", ") || "none"}`,
          `- your focus lines: ${unit.focusLines.join(", ") || "none"}`,
          `- the codex rules to read: call codex_rule_get on each rule of scope ${ctx.scope} your file triggers`,
          `- your test command: ${ctx.commands.test} ${unit.file}`,
          `- write your waiver and exemption requests to: ${requestsFile(ctx, unit.file)}`,
        ]),
      ].join("\n");

const write = async (ctx: Ctx, work: Map<string, string[]>, label: string): Promise<void> => {
  const files = [...work.keys()];
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
      ],
    });
  });
  await unitUpsertBatch({
    cwd: ctx.cwd,
    runId: ctx.runId,
    units: files.map((file) => ({ filePath: file, state: "drafted" })),
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

const settle = async (ctx: Ctx): Promise<GatesEvaluation> => {
  let work = new Map(ctx.units.map((unit) => [unit.file, ["Write the first draft of your file."]]));
  let gates = await evaluate(ctx, false);
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    ctx.pass = round;
    if (work.size > 0) await write(ctx, work, `write-${round}`);
    gates = await evaluate(ctx, true);

    const inspectNow = new Set(work.keys());
    for (const file of routeWork(ctx.units, gates.workList, ctx.ruledTests).inspect) inspectNow.add(file);
    if (inspectNow.size > 0) {
      await inspect(ctx, [...inspectNow], `inspect-${round}`);
      gates = await evaluate(ctx, false);
    }

    const toVerify = routeWork(ctx.units, gates.workList, ctx.ruledTests).verify;
    if (toVerify.length > 0) {
      await verify(ctx, toVerify, `verify-${round}`);
      gates = await evaluate(ctx, false);
    }

    await resolveEscalations(ctx);
    await signRequests(ctx);
    gates = await evaluate(ctx, false);

    const pending = gates.workList.filter((item) => !SETTLED_LATER.includes(item.predicate));
    work = routeWork(ctx.units, pending, ctx.ruledTests).byFile;
    if (work.size === 0) break;
  }
  return gates;
};

const mutants = (ctx: Ctx, outcomes: readonly string[]): Mutant[] =>
  all<Mutant>(
    openDb(),
    `SELECT id, file_path, line, operator, outcome FROM mutants WHERE run_id = ? AND outcome IN (${outcomes.map(() => "?").join(", ")}) ORDER BY file_path, line`,
    [ctx.runId, ...outcomes],
  );

const claimsFor = (ids: readonly number[]): Claim[] =>
  ids.length === 0
    ? []
    : all<Claim>(
        openDb(),
        `SELECT mutant_id, claimed_by, argument FROM equivalence_claims WHERE mutant_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
        [...ids],
      );

const runMutants = async (ctx: Ctx, campaignId: number, list: readonly Mutant[]): Promise<void> => {
  for (const [source, group] of groupBy(list, (mutant) => mutant.file_path)) {
    const tests = unitsForSource(ctx.units, source).map((unit) => unit.file);
    const result = await mutationBatchRun({
      cwd: ctx.cwd,
      mutantIds: group.map((mutant) => mutant.id),
      tests: tests.length > 0 ? tests : ctx.units.map((unit) => unit.file),
      campaignId,
      bail: false,
      command: `npx vitest run --project ${ctx.scope}`,
    });
    ctx.host.log(
      result.ok
        ? `mutants ${source}: ${JSON.stringify(result.counts)}`
        : `mutants ${source} did not run: ${result.reason}`,
    );
  }
};

const huntSurvivors = async (ctx: Ctx, round: number): Promise<Map<string, string[]>> => {
  const survived = mutants(ctx, ["survived"]);
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

  const work = new Map<string, string[]>();
  const add = (source: string, line: string): void => {
    const unit = unitsForSource(ctx.units, source)[0] ?? ctx.units[0];
    if (unit) work.set(unit.file, [...(work.get(unit.file) ?? []), line]);
  };
  for (const source of new Set(survived.map((mutant) => mutant.file_path))) {
    for (const hole of readJsonList<{ mutantId: number; test: string }>(holesFile(ctx, source), "holes")) {
      add(source, `Mutant ${hole.mutantId} in ${source} survived: ${hole.test}`);
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
    add(mutant.file_path, `Mutant ${mutant.id} at ${mutant.file_path}:${mutant.line} is not equivalent: ${text.slice(0, 600)}`);
  }
  return work;
};

const signEquivalences = async (ctx: Ctx): Promise<void> => {
  const pending = mutants(ctx, ["equivalent-claimed"]);
  const claims = claimsFor(pending.map((mutant) => mutant.id));
  if (claims.length === 0) return;
  const answer = await ctx.host.ask(
    "sign",
    [
      `Test Forge run ${ctx.runId}: ${claims.length} mutant(s) survived, and the hunter could not refute their equivalence claims. Signing says no test can tell them apart from the real code.`,
      "",
      ...claims.map((claim) => `- mutant ${claim.mutant_id}: ${claim.argument.slice(0, 500)}`),
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
};

const mutate = async (ctx: Ctx): Promise<string | undefined> => {
  const sources = [...new Set(ctx.units.flatMap((unit) => unit.sources))];
  const lines = ctx.host.targets ? undefined : changedRanges(ctx.cwd, ctx.host.base, sources);
  const generated = await mutationGenerate({ cwd: ctx.cwd, files: sources, runId: ctx.runId, lines });
  ctx.host.log(`mutation: ${generated.mutants.length} mutants on ${sources.length} files`);
  if (generated.mutants.length === 0) return "No mutant could be generated on the changed lines.";

  const started = await campaignStart({ cwd: ctx.cwd });
  if (!started.ok) return `The mutation lanes did not start: ${started.reason}`;
  const campaignId = started.campaign.campaignId;
  try {
    await runMutants(ctx, campaignId, mutants(ctx, ["pending", "error", "timeout"]));
    for (let round = 1; round <= MAX_MUTATION_ROUNDS; round += 1) {
      const work = await huntSurvivors(ctx, round);
      if (work.size === 0) break;
      await write(ctx, work, `kill-${round}`);
      await runMutants(ctx, campaignId, mutants(ctx, ["survived", "refuted", "pending", "error", "timeout"]));
    }
    await signEquivalences(ctx);
  } finally {
    await campaignStop({ cwd: ctx.cwd, campaignId });
  }
  return undefined;
};

const prune = async (ctx: Ctx): Promise<void> => {
  const gates = await evaluate(ctx, true);
  const unearned = gates.workList.filter((item) => item.predicate === "D6");
  const work = routeWork(ctx.units, unearned, ctx.ruledTests).byFile;
  if (work.size === 0) return;
  for (const [file, lines] of work) {
    work.set(file, [
      "Prune: each test below kills no mutant of its own. Delete it, or, only when it is a red test for a confirmed defect, a contract tripwire, a regression guard that names its ticket, or the only test of a radius node, write an exemption request.",
      ...lines,
    ]);
  }
  await write(ctx, work, "prune");
  await signRequests(ctx);
};

const close = async (ctx: Ctx, blocker?: string): Promise<ForgeResult> => {
  await resolveEscalations(ctx);
  const gates = await evaluate(ctx, true);
  const { exitKind, failing, notUsed } = exitDecision({
    mode: ctx.mode,
    predicates: gates.predicates,
    stalled: gates.stalled,
    hasBlocker: blocker !== undefined,
  });
  const counted = (item: WorkItem): boolean => !notUsed.includes(item.predicate);
  const reason =
    exitKind === "DONE"
      ? [
          "every counted predicate holds",
          notUsed.length > 0 ? `${notUsed.join(", ")} not used in harden mode` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : [
          blocker,
          `failing: ${failing.join(", ") || "none"}`,
          notUsed.length > 0 ? `${notUsed.join(", ")} not used in harden mode` : "",
          ...gates.workList.filter(counted).slice(0, 8).map((item) => `${item.predicate} ${item.ref}: ${item.reason}`),
        ]
          .filter(Boolean)
          .join("; ");
  await runEnd({ cwd: ctx.cwd, runId: ctx.runId, exitKind, exitReason: reason });
  const defects = (await state({ cwd: ctx.cwd, runId: ctx.runId })).findings
    .filter((finding) => finding.status === "confirmed-defect")
    .map((finding) => ({ findingKey: finding.findingKey, title: finding.title }));
  return {
    status: exitKind === "DONE" ? "done" : "escalated",
    summary: `Test Forge run ${ctx.runId} (${ctx.scope}, ${ctx.host.depth}) ${exitKind}: ${reason}. ${defects.length} confirmed defect(s) for the builder.`,
    runId: ctx.runId,
    scope: ctx.scope,
    defects,
  };
};

const hardenFile = (ctx: Ctx): string => path.join(ctx.dir, "harden-baseline.json");

const readWorktreeFile = (ctx: Ctx) => (file: string): string => {
  try {
    return fs.readFileSync(path.join(ctx.cwd, file), "utf8");
  } catch {
    return "";
  }
};

const openBaseline = (ctx: Ctx): void => {
  const read = readWorktreeFile(ctx);
  if (fs.existsSync(hardenFile(ctx))) {
    ctx.baseline = JSON.parse(fs.readFileSync(hardenFile(ctx), "utf8")) as TestBaseline;
    return;
  }
  ctx.baseline = baselineOf(
    ctx.units.map((unit) => unit.file),
    read,
  );
  fs.writeFileSync(hardenFile(ctx), JSON.stringify(ctx.baseline, null, 2));
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

const harden = async (ctx: Ctx): Promise<ForgeResult> => {
  const sources = changedProductionFiles(ctx.cwd, ctx.host.base);
  const units = existingUnits({
    sources,
    testFiles: worktreeFiles(ctx.cwd),
    scope: ctx.scope,
    read: readWorktreeFile(ctx),
  });
  if (units.length === 0) {
    return close(ctx, "No existing usecase-level test imports a changed production file. Run the write mode.");
  }
  ctx.units = units;
  openBaseline(ctx);
  ctx.host.log(`harden: ${units.length} existing test file(s) cover ${sources.length} changed file(s)`);

  const blocked = await mutate(ctx);
  if (blocked) return close(ctx, blocked);
  const lost = await restoreProtected(ctx);
  if (lost) return close(ctx, lost);

  const changed = changedTestFiles(ctx.baseline, readWorktreeFile(ctx));
  if (changed.length > 0) {
    await unitUpsertBatch({
      cwd: ctx.cwd,
      runId: ctx.runId,
      units: changed.map((file) => ({ filePath: file, state: "drafted" })),
    });
    let gates = await evaluate(ctx, true);
    await inspect(ctx, changed, "inspect-harden");
    gates = await evaluate(ctx, false);
    const toVerify = routeWork(ctx.units, gates.workList, ctx.ruledTests).verify;
    if (toVerify.length > 0) await verify(ctx, toVerify, "verify-harden");
    await resolveEscalations(ctx);
    await signRequests(ctx);
  }
  return close(ctx);
};

export const runForge = async (host: ForgeHost): Promise<ForgeResult> => {
  const prepared = await prepare(host);
  if (typeof prepared === "string") {
    host.log(prepared);
    return { status: "escalated", summary: `refused: ${prepared}`, runId: null, scope: null, defects: [], refusal: prepared };
  }
  const ctx = prepared;
  host.log(`Test Forge run ${ctx.runId} (${ctx.scope}, ${host.depth}, ${ctx.mode})`);

  if (ctx.mode === "harden") return harden(ctx);

  const unmapped = await map(ctx);
  if (unmapped) return close(ctx, unmapped);

  const settled = await settle(ctx);
  const open = settled.workList.filter((item) => !SETTLED_LATER.includes(item.predicate));
  if (open.length > 0) {
    return close(ctx, `${open.length} item(s) did not settle after ${MAX_ROUNDS} rounds`);
  }

  if (host.depth === "full") {
    const blocked = await mutate(ctx);
    if (blocked) return close(ctx, blocked);
    await prune(ctx);
  }
  return close(ctx);
};
