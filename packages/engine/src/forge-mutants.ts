import fs from "node:fs";
import { all, openDb } from "test-forge-mcp-server/src/infrastructure/db/connection.ts";
import type { DoneVector } from "test-forge-contracts/gates";
import { testNames, type ExitDecision, type TestBaseline } from "./forge-harden.ts";
import { sameFile, unitsForSource, type LineRange, type Unit } from "./forge-units.ts";
import type { LedgerMutantView } from "./mutant-events.ts";
import { isTestPath } from "./test-paths.ts";

export type TestRef = { file: string; name: string };

export type LedgerMutant = LedgerMutantView & {
  endLine: number;
  status: string;
  coveredBy: TestRef[];
  killedBy: TestRef[];
};

export type NewTest = { file: string; name: string; targets: number[] };

export type GateOutcome = { test: NewTest; killed: number[]; verify: number[] };

export type TestTarget = { name: string; mutants: number[] };

export type Assignment = {
  byFile: Map<string, LedgerMutant[]>;
  newFiles: Map<string, string[]>;
  unassigned: LedgerMutant[];
};

export type ClaimView = {
  mutantId: number;
  argument: string;
  refutedBy: string | null;
  refutation: string | null;
  upheld: number | null;
  signedBy: string | null;
};

export type ReportInput = {
  ticket: string;
  runId: number;
  scope: string;
  worktree: string;
  base: string;
  baseRef: string;
  mergeBase: string;
  scopeRule: string;
  changed: Record<string, readonly LineRange[]>;
  stryker: { version: string; concurrency: number; timeoutFactor: number; timeoutMs: number };
  mutants: readonly LedgerMutant[];
  outOfScope: number;
  claims: readonly ClaimView[];
  proofs: Readonly<Record<string, readonly number[]>>;
  refused: readonly string[];
  blocker: string | undefined;
};

export const OPEN_OUTCOMES: ReadonlySet<string> = new Set(["survived", "no_coverage"]);

export const KILLED_OUTCOMES: ReadonlySet<string> = new Set(["killed", "killed_by_timeout"]);

const FINAL_OUTCOMES: ReadonlySet<string> = new Set([
  "killed",
  "killed_by_timeout",
  "unviable",
  "equivalent-signed",
]);

const COUNTED_PREDICATES = ["D1", "D2", "D3", "D4", "D10"] as const;

const NOT_USED_PREDICATES = ["D5", "D6", "D7", "D8", "D9"] as const;

const LINE_CLIP = 160;

type MutantRecord = {
  id: number;
  file_path: string;
  line: number;
  end_line: number | null;
  operator: string;
  before_text: string;
  after_text: string;
  outcome: string;
  stryker_status: string | null;
  covered_by_json: string | null;
};

type KillRecord = { mutant_id: number; file_path: string; test_name: string };

type ClaimRecord = {
  mutant_id: number;
  argument: string;
  refuted_by: string | null;
  refutation: string | null;
  upheld: number | null;
  signed_by: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const testRefsOf = (json: string | null): TestRef[] => {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.flatMap((entry) =>
          isRecord(entry) && typeof entry.file === "string" && typeof entry.name === "string"
            ? [{ file: entry.file, name: entry.name }]
            : [],
        )
      : [];
  } catch {
    return [];
  }
};

export const ledgerMutants = (runId: number): LedgerMutant[] => {
  const db = openDb();
  const kills = new Map<number, TestRef[]>();
  for (const kill of all<KillRecord>(
    db,
    "SELECT k.mutant_id, k.file_path, k.test_name FROM kills k JOIN mutants m ON m.id = k.mutant_id WHERE m.run_id = ?",
    [runId],
  )) {
    kills.set(kill.mutant_id, [
      ...(kills.get(kill.mutant_id) ?? []),
      { file: kill.file_path, name: kill.test_name },
    ]);
  }
  return all<MutantRecord>(
    db,
    "SELECT id, file_path, line, end_line, operator, before_text, after_text, outcome, stryker_status, covered_by_json FROM mutants WHERE run_id = ? AND engine = 'stryker' AND outcome != 'out_of_scope' ORDER BY file_path, line, start_column, id",
    [runId],
  ).map((row) => ({
    id: row.id,
    file: row.file_path,
    line: row.line,
    endLine: row.end_line ?? row.line,
    mutator: row.operator,
    original: row.before_text,
    replacement: row.after_text,
    outcome: row.outcome,
    status: row.stryker_status ?? "",
    coveredBy: testRefsOf(row.covered_by_json),
    killedBy: kills.get(row.id) ?? [],
  }));
};

export const outOfScopeCount = (runId: number): number =>
  all<{ total: number }>(
    openDb(),
    "SELECT COUNT(*) AS total FROM mutants WHERE run_id = ? AND engine = 'stryker' AND outcome = 'out_of_scope'",
    [runId],
  )[0]?.total ?? 0;

export const claimsOf = (ids: readonly number[]): ClaimView[] =>
  ids.length === 0
    ? []
    : all<ClaimRecord>(
        openDb(),
        `SELECT mutant_id, argument, refuted_by, refutation, upheld, signed_by FROM equivalence_claims WHERE mutant_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
        [...ids],
      ).map((row) => ({
        mutantId: row.mutant_id,
        argument: row.argument,
        refutedBy: row.refuted_by,
        refutation: row.refutation,
        upheld: row.upheld,
        signedBy: row.signed_by,
      }));

export const openMutants = (mutants: readonly LedgerMutant[]): LedgerMutant[] =>
  mutants.filter((mutant) => OPEN_OUTCOMES.has(mutant.outcome));

export const unresolvedMutants = (mutants: readonly LedgerMutant[]): LedgerMutant[] =>
  mutants.filter((mutant) => !FINAL_OUTCOMES.has(mutant.outcome));

const clip = (text: string, limit: number): string => {
  const flat = text.split(/\s+/).join(" ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat;
};

export const spanOf = (mutant: LedgerMutant): string =>
  `${mutant.file}:${mutant.line}${mutant.endLine > mutant.line ? `-${mutant.endLine}` : ""}`;

export const mutantLine = (mutant: LedgerMutant, hint?: string): string => {
  const names = [...new Set(mutant.coveredBy.map((test) => test.name))].slice(0, 5);
  const state =
    mutant.outcome === "no_coverage"
      ? "no test covers it"
      : `survived ${mutant.coveredBy.length} covering test(s)${names.length > 0 ? `: ${names.join("; ")}` : ""}`;
  return [
    `M${mutant.id}`,
    spanOf(mutant),
    mutant.mutator,
    `\`${clip(mutant.original, LINE_CLIP)}\` -> \`${clip(mutant.replacement, LINE_CLIP)}\``,
    state,
    ...(hint ? [`hint: ${hint}`] : []),
  ].join(" · ");
};

export const fallbackTestPath = (source: string): string =>
  source.replace(/\.(tsx?)$/, ".test.$1");

const coveringFilesOf = (mutant: LedgerMutant): string[] => {
  const counts = new Map<string, number>();
  for (const test of mutant.coveredBy) counts.set(test.file, (counts.get(test.file) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([file]) => file);
};

export const testFileFor = (input: {
  mutant: LedgerMutant;
  units: readonly Unit[];
  restrictToUnits: boolean;
}): string | undefined => {
  const { mutant, units, restrictToUnits } = input;
  const canonical = (file: string): string =>
    units.find((unit) => sameFile(unit.file, file))?.file ?? file;
  const covering = coveringFilesOf(mutant).filter(
    (file) =>
      isTestPath(file) && (!restrictToUnits || units.some((unit) => sameFile(unit.file, file))),
  );
  const paired = unitsForSource(units, mutant.file).map((unit) => unit.file);
  const preferred = covering.find((file) => paired.some((entry) => sameFile(entry, file)));
  const chosen = preferred ?? covering[0] ?? paired[0];
  return chosen === undefined ? undefined : canonical(chosen);
};

export const sourcesWithoutTestFile = (
  mutants: readonly LedgerMutant[],
  units: readonly Unit[],
): string[] => [
  ...new Set(
    mutants
      .filter((mutant) => testFileFor({ mutant, units, restrictToUnits: false }) === undefined)
      .map((mutant) => mutant.file),
  ),
];

export const assignMutants = (input: {
  mutants: readonly LedgerMutant[];
  units: readonly Unit[];
  restrictToUnits: boolean;
  newFileFor: (source: string) => string;
}): Assignment => {
  const assignment: Assignment = { byFile: new Map(), newFiles: new Map(), unassigned: [] };
  for (const mutant of input.mutants) {
    const existing = testFileFor({
      mutant,
      units: input.units,
      restrictToUnits: input.restrictToUnits,
    });
    if (existing === undefined && input.restrictToUnits) {
      assignment.unassigned.push(mutant);
      continue;
    }
    const file = existing ?? input.newFileFor(mutant.file);
    if (existing === undefined) {
      assignment.newFiles.set(file, [
        ...new Set([...(assignment.newFiles.get(file) ?? []), mutant.file]),
      ]);
    }
    assignment.byFile.set(file, [...(assignment.byFile.get(file) ?? []), mutant]);
  }
  return assignment;
};

export const readTargets = (file: string): TestTarget[] => {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = isRecord(parsed) && Array.isArray(parsed.tests) ? parsed.tests : [];
    return list.flatMap((entry): TestTarget[] =>
      isRecord(entry) && typeof entry.name === "string"
        ? [
            {
              name: entry.name,
              mutants: Array.isArray(entry.mutants)
                ? entry.mutants
                    .map((id) => (typeof id === "string" ? Number(id.replace(/^M/i, "")) : id))
                    .filter((id): id is number => Number.isInteger(id))
                : [],
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
};

export const newTestsOf = (input: {
  baseline: TestBaseline;
  file: string;
  content: string;
  targets: readonly TestTarget[];
}): NewTest[] => {
  const known = new Set(input.baseline[input.file]?.names ?? []);
  const listed = new Map(input.targets.map((target) => [target.name, target.mutants]));
  return testNames(input.content)
    .filter((name) => !known.has(name) || listed.has(name))
    .map((name) => ({ file: input.file, name, targets: listed.get(name) ?? [] }));
};

export const testKeyOf = (test: { file: string; name: string }): string =>
  `${test.file}::${test.name}`;

export const sameTest = (kill: TestRef, test: { file: string; name: string }): boolean => {
  if (!sameFile(kill.file, test.file)) return false;
  if (kill.name === test.name) return true;
  const start = kill.name.length - test.name.length;
  return start > 0 && kill.name.endsWith(test.name) && /[\s>]/.test(kill.name.charAt(start - 1));
};

export const fullNameOf = (test: NewTest, mutants: readonly LedgerMutant[]): string =>
  mutants
    .flatMap((mutant) => [...mutant.coveredBy, ...mutant.killedBy])
    .find((ref) => sameTest(ref, test))?.name ?? test.name;

export const gateTests = (input: {
  eligible: ReadonlySet<number>;
  mutants: readonly LedgerMutant[];
  tests: readonly NewTest[];
}): GateOutcome[] => {
  const byId = new Map(input.mutants.map((mutant) => [mutant.id, mutant]));
  return input.tests.map((test) => {
    const killed = input.mutants
      .filter(
        (mutant) =>
          input.eligible.has(mutant.id) &&
          KILLED_OUTCOMES.has(mutant.outcome) &&
          mutant.killedBy.some((kill) => sameTest(kill, test)),
      )
      .map((mutant) => mutant.id);
    const verify =
      killed.length > 0
        ? []
        : test.targets.filter((id) => {
            const target = byId.get(id);
            return (
              input.eligible.has(id) && target !== undefined && KILLED_OUTCOMES.has(target.outcome)
            );
          });
    return { test, killed, verify };
  });
};

export const refusalLine = (test: NewTest, hint: readonly number[]): string =>
  `The test "${test.name}" kills no mutant that survived before it. Make it kill ${hint.length > 0 ? hint.map((id) => `M${id}`).join(", ") : "one of the open mutants of this file"}, or delete it.`;

export const mutationExitDecision = (input: {
  predicates: DoneVector;
  stalled: boolean;
  hasBlocker: boolean;
}): ExitDecision => {
  const counted: readonly string[] = COUNTED_PREDICATES;
  const failing = Object.entries(input.predicates)
    .filter(([id, value]) => !value && counted.includes(id.toUpperCase()))
    .map(([id]) => id.toUpperCase());
  const exitKind = input.hasBlocker
    ? "BLOCKED"
    : failing.length === 0
      ? "DONE"
      : input.stalled
        ? "STALLED"
        : "BLOCKED";
  return { exitKind, failing, notUsed: [...NOT_USED_PREDICATES] };
};

const rangesText = (ranges: readonly LineRange[]): string =>
  ranges.map(([from, to]) => (to === from ? `${from}` : `${from}-${to}`)).join(", ") || "none";

const cell = (text: string): string => clip(text.split("|").join("\\|"), 400);

const claimOf = (claims: readonly ClaimView[], id: number): ClaimView | undefined =>
  claims.filter((claim) => claim.mutantId === id).at(-1);

const survivorReason = (claim: ClaimView | undefined): string => {
  if (!claim) return "No test kills it and no equivalence claim was filed.";
  if (claim.refutedBy) return `The equivalence claim was refuted: ${claim.refutation ?? ""}`;
  return `Equivalence claimed, not signed: ${claim.argument}`;
};

export const renderMutationReport = (input: ReportInput): string => {
  const states = [...new Set(input.mutants.map((mutant) => mutant.outcome))].sort();
  const files = [...new Set(input.mutants.map((mutant) => mutant.file))].sort();
  const survivors = input.mutants.filter((mutant) => !FINAL_OUTCOMES.has(mutant.outcome));
  const signed = input.mutants.filter((mutant) => mutant.outcome === "equivalent-signed");
  const proofRows = Object.entries(input.proofs).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  const command = JSON.stringify({
    cwd: input.worktree,
    base: input.base,
    runId: input.runId,
    scopeRule: input.scopeRule,
  });
  return [
    `# Mutation report for ${input.ticket}`,
    "",
    `Test Forge run ${input.runId} (${input.scope}). ${input.blocker ? `Run ended BLOCKED: ${input.blocker}` : "Every in-scope mutant has a final state."}`,
    "",
    "## Scope",
    "",
    `A mutant is in scope when its span touches a changed line (rule \`${input.scopeRule}\`). Changed lines are \`git diff -U0\` of the working tree against the merge base ${input.mergeBase} of HEAD and ${input.baseRef}.`,
    "",
    "| File | Changed line ranges |",
    "| --- | --- |",
    ...Object.entries(input.changed)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([file, ranges]) => `| ${cell(file)} | ${rangesText(ranges)} |`),
    "",
    `In-scope mutants: ${input.mutants.length}. Out of scope (nested in a selected range, never gated): ${input.outOfScope}.`,
    "",
    "## Tool and settings",
    "",
    `- Stryker ${input.stryker.version} with the vitest runner, run from the worktree as cwd, sandbox copy, coverage analysis perTest, bail on, incremental file per ticket`,
    `- concurrency ${input.stryker.concurrency}, timeout factor ${input.stryker.timeoutFactor}, timeout base ${input.stryker.timeoutMs} ms, no excluded mutator`,
    "- extra operators: ExtraJsxBooleanAttribute, ExtraLogicalOperand, ExtraNumberLiteral, run on the same harness",
    "- every Timeout re-runs alone on the covering tests only; a second timeout is recorded as killed by timeout",
    "",
    "## Counts per file and final state",
    "",
    `| File | ${states.join(" | ")} | total |`,
    `| --- | ${states.map(() => "---").join(" | ")} | --- |`,
    ...files.map((file) => {
      const rows = input.mutants.filter((mutant) => mutant.file === file);
      return `| ${cell(file)} | ${states.map((state) => rows.filter((mutant) => mutant.outcome === state).length).join(" | ")} | ${rows.length} |`;
    }),
    "",
    "## Survivors",
    "",
    ...(survivors.length === 0
      ? ["None."]
      : survivors.map(
          (mutant) =>
            `- M${mutant.id} ${spanOf(mutant)} ${mutant.mutator} \`${clip(mutant.original, 80)}\` -> \`${clip(mutant.replacement, 80)}\` (${mutant.outcome}): ${clip(survivorReason(claimOf(input.claims, mutant.id)), 400)}`,
        )),
    "",
    "## Signed equivalents",
    "",
    ...(signed.length === 0
      ? ["None."]
      : signed.map((mutant) => {
          const claim = claimOf(input.claims, mutant.id);
          return `- M${mutant.id} ${spanOf(mutant)} ${mutant.mutator} \`${clip(mutant.original, 80)}\` -> \`${clip(mutant.replacement, 80)}\`, signed by ${claim?.signedBy ?? "unknown"}: ${clip(claim?.argument ?? "", 600)}`;
        })),
    "",
    "## Kill proofs",
    "",
    ...(proofRows.length === 0
      ? ["No new test was added."]
      : proofRows.map(([test, ids]) => `- ${test} kills ${ids.map((id) => `M${id}`).join(", ")}`)),
    ...(input.refused.length > 0
      ? ["", "Tests that kill no mutant:", ...input.refused.map((test) => `- ${test}`)]
      : []),
    "",
    "## Reproduce",
    "",
    "Tool call (test-forge MCP), with a ledger run opened by ledger_run_start:",
    "",
    "```",
    `stryker_mutation_pass ${command}`,
    "```",
    "",
    "In process:",
    "",
    "```",
    `const { mutationPass } = await import("packages/test-forge/packages/mcp/src/application/stryker/mutation-pass.ts")`,
    `await mutationPass(${command})`,
    "```",
    "",
  ].join("\n");
};
