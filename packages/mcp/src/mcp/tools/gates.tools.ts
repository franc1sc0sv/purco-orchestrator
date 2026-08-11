import { evaluateGates } from "../../application/gates/evaluate.ts";
import type {
  GateCommands,
  ProbeRequest,
} from "../../application/gates/evaluate.ts";
import { gateStatus } from "../../application/gates/status.ts";
import { listView } from "../../application/listing/list-view.ts";
import { pageInput } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const cwd = z
  .string()
  .describe("Absolute path inside the project the run belongs to.");

const runId = z
  .number()
  .int()
  .describe("Run identifier from ledger_run_start.");

const commandsSchema = z
  .object({
    test: z
      .string()
      .describe("The project test command, for example 'yarn test:backend'.")
      .optional(),
    typecheck: z.string().describe("For example 'yarn tsc'.").optional(),
    lint: z.string().describe("For example 'yarn lint:all'.").optional(),
  })
  .strict();

const probeSchema = z
  .object({
    repeats: z
      .number()
      .int()
      .describe("How many times to run the suite looking for divergence.")
      .optional(),
    seed: z
      .number()
      .int()
      .describe("Seed passed to the runner, so a divergence is reproducible.")
      .optional(),
  })
  .strict();

const evaluateInput = z
  .object({
    cwd,
    runId,
    commands: commandsSchema
      .describe(
        "Run these before deriving, and store what they produce as evidence. Omit to derive from the evidence already stored."
      )
      .optional(),
    files: z
      .array(z.string())
      .describe("Files to run. Defaults to every unit of the run.")
      .optional(),
    probe: probeSchema
      .describe("Also run a flake probe with the test command.")
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .describe("Hard timeout per command in milliseconds.")
      .optional(),
    page: pageInput.optional(),
  })
  .strict();

const statusInput = z
  .object({
    cwd,
    runId,
    gate: z
      .number()
      .int()
      .min(1)
      .max(8)
      .describe(
        "Which gate to open: 1 syntax and static, 2 flake probe, 3 aspect conformance and focus, 4 matrix and closure, 5 finding verification, 6 mutation and equivalence, 7 test value attribution, 8 open escalations."
      ),
  })
  .strict();

const toCommands = (input: z.infer<typeof commandsSchema>): GateCommands => ({
  ...(input.test === undefined ? {} : { test: input.test }),
  ...(input.typecheck === undefined ? {} : { typecheck: input.typecheck }),
  ...(input.lint === undefined ? {} : { lint: input.lint }),
});

const toProbe = (input: z.infer<typeof probeSchema>): ProbeRequest => ({
  ...(input.repeats === undefined ? {} : { repeats: input.repeats }),
  ...(input.seed === undefined ? {} : { seed: input.seed }),
});

export const registerGatesTools = (server: McpServer): void => {
  server.registerTool(
    "gates_evaluate",
    {
      title: "Evaluate the ten predicates",
      description: [
        "Computes the ten predicates of the done vector from the evidence stored for the run, and records the result as the next pass. The caller must NOT compute a predicate and must not pass one in: this tool derives every one of them from static gate results, flake probes, the suite result, verdicts, findings, waivers, coverage cells, closure nodes, focus lines, mutants and open escalations, and it is the only thing entitled to say whether a predicate is true. Pass commands to run the project's test, typecheck and lint first and store fresh evidence before deriving.",
        "",
        "The returned workList is the assignment list for the orchestrator. Every entry is one failing subject with the predicate it broke, the gate that predicate sits behind, the reason, and the location that proves it. Assign the work list, run again, and compare: an empty work list with allTrue true is DONE, and a work list identical to the previous pass sets stalled true, which means the loop stopped moving and the run must exit STALLED rather than repeat itself.",
        "",
        "The ten predicates: D1 SYNTAX, D2 CONFORMANCE, D3 STABLE, D4 VERIFIED, D5 MUTATION, D6 VALUE, D7 COMPLETE, D8 RADIUS, D9 FOCUS, D10 ESCALATION.",
        "",
        "D10 ESCALATION is false while any escalation raised on the run is still open, and it is its own gate, gate 8, so it is visible rather than folded into another gate. Nothing else can turn it true: an open escalation is closed only by escalation_resolve, which demands a named author and a written reason, and a run whose rules are known to be wrong therefore cannot report every gate green at the same moment. Read the open list with escalation_open.",
        "",
        "D4 VERIFIED does not require a green suite. A red test whose defect carries a Noble Team verdict of confirmed-defect or confirmed-but-known, or a finding recorded at that status, or a signed waiver, counts as accounted for and D4 stays true: a confirmed defect may remain red and does not block the run. What makes D4 false is an unverified red - a failing test that no agent has judged. Record that judgement with ledger_verdict_record before evaluating again.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run identifier from ledger_run_start.",
        "- commands (object, optional): { test?: string, typecheck?: string, lint?: string }. Run before deriving and stored as evidence. Omit to derive from the evidence already stored.",
        "- files (string[], optional): files to run. Defaults to every unit of the run.",
        "- probe (object, optional): { repeats?: integer, seed?: integer }. Also run a flake probe with the test command.",
        "- timeoutMs (integer, optional): hard timeout per command in milliseconds.",
        "- page (object, optional): { offset, limit } opens a window of the work list. Omit it and only the summary comes back.",
        "",
        "Returns: { projectKey: string, runId: number, passNo: number, collected: { static?: { ok: boolean, errors: number }, suite?: { reportParsed: boolean, passed: number | null, failed: number | null }, flake?: { stable: boolean, divergences: number } }, predicates: { d1..d10: boolean }, gates: Array<{ gate: 1..8, name: string, status: 'pass' | 'fail', evidence: { predicates: string[], checked: number, passed: number, failed: number, firstFailures: Array<{ predicate, ref, reason, location }> } }>, workList: ListView, allTrue: boolean, stalled: boolean }. The work list ListView carries { total, groups by predicate, sample, handle, page?, items? } and its handle path is a JSON file holding every assignment, so the whole list survives even when it is not inlined.",
        "",
        "Examples:",
        "- Use it once per pass of an operation, with commands, to refresh the evidence and get the next assignment list.",
        "- Use it without commands to re-derive after recording verdicts or waivers, when no test needs to run again.",
        "- Do NOT use it to store a vector you worked out yourself: that is what ledger_pass_record is for, and using both in one pass double-counts the passes.",
        "- Do NOT use it to read why one gate failed in full: it returns only the first failures per gate. Call gates_status with that gate number.",
        "- Do NOT use it to read what is recorded for the run: call ledger_state, which reports rather than derives.",
        "",
        "Truncation: the work list comes back as a bounded summary, so a long list no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unknown runId fails the call. A command that exits non-zero is not an error; its output becomes evidence and the predicate behind it goes false with the problems named. A test command whose report cannot be parsed leaves D4 false with the parser message, because an unreadable suite result proves nothing.",
      ].join("\n"),
      inputSchema: evaluateInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ cwd: root, runId: id, commands, files, probe, timeoutMs, page }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for the whole work list.",
        async () => {
          const evaluation = await evaluateGates({
            cwd: root,
            runId: id,
            ...(commands === undefined
              ? {}
              : { commands: toCommands(commands) }),
            ...(files === undefined ? {} : { files }),
            ...(probe === undefined ? {} : { probe: toProbe(probe) }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          });
          return {
            ...evaluation,
            workList: listView({
              kind: "gates-worklist",
              items: evaluation.workList,
              label: (item) => `${item.predicate} ${item.ref}: ${item.reason}`,
              group: (item) => item.predicate,
              page,
            }),
          };
        }
      )
  );

  server.registerTool(
    "gates_status",
    {
      title: "One gate in detail",
      description: [
        "Opens one gate, 1 through 8, and reports what it checked, what passed and what failed, each failure with the location that proves it. Gate 1 syntax and static (D1), 2 flake probe (D3), 3 aspect conformance and focus (D2, D9), 4 matrix and closure (D7, D8), 5 finding verification (D4), 6 mutation and equivalence (D5), 7 test value attribution (D6), 8 open escalations (D10). It derives the predicates from the same stored evidence gates_evaluate uses, but records nothing: no pass is written and no command is run.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run identifier from ledger_run_start.",
        "- gate (integer 1 to 8): which gate to open.",
        "",
        "Returns: { projectKey: string, runId: number, gate: 1..8, name: string, status: 'pass' | 'fail', predicates: Array<{ predicate: 'D1'..'D10', name: string, value: boolean, indeterminate: string | null, checked: string[], passed: string[], failed: Array<{ ref, reason, location }> }>, evidence: Array<{ kind: 'static' | 'flake' | 'suite', stored: boolean, ok: boolean | null, recordedAt: string | null }> }. A predicate with indeterminate set was not computed at all: its value is false because a gate cannot open on an unknown, and the string says what to do about it. D6 comes back indeterminate when any kill row of the run was recorded under bail, since unique-kill attribution needs every test that kills a mutant.",
        "",
        "Examples:",
        "- Use it after gates_evaluate reports a gate failing, to read every failed subject rather than the first few.",
        "- Use it to check whether the evidence a gate needs was ever stored, which the evidence array reports per kind.",
        "- Do NOT use it to advance the run: it records no pass and refreshes no evidence. Call gates_evaluate.",
        "- Do NOT use it to run the suite: it reads stored evidence only. Pass commands to gates_evaluate.",
        "",
        "Truncation: a gate over a large run can list many checked and failed subjects and exceed the 25000 character limit; the text is cut with a TRUNCATED notice. Narrow the result by opening a single gate rather than sweeping all eight.",
        "",
        "Error handling: a gate outside 1 to 8 fails the call naming the bound. An unknown runId fails the call. A gate whose evidence was never stored is not an error; its predicate comes back false with the reason naming the evidence that is missing. Gate 7 over a run whose kills were recorded under bail comes back with D6 indeterminate rather than a unique-kill verdict, and the fix is to run the mutants again without bail, not to prune a test.",
      ].join("\n"),
      inputSchema: statusInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd: root, runId: id, gate }) =>
      respondAsync(
        "Open one gate per call. A single gate over a large run cannot be narrowed further; read the run with ledger_state instead.",
        () => gateStatus({ cwd: root, runId: id, gate })
      )
  );
};
