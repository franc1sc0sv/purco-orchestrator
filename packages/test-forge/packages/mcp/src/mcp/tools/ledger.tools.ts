import { findingKnown } from "../../application/ledger/finding-known.ts";
import { findingUpsertBatch } from "../../application/ledger/finding-upsert-batch.ts";
import { findingUpsert } from "../../application/ledger/finding-upsert.ts";
import { matrixUpsert } from "../../application/ledger/matrix-upsert.ts";
import { overturnRecord } from "../../application/ledger/overturn-record.ts";
import { passRecord } from "../../application/ledger/pass-record.ts";
import { runEnd } from "../../application/ledger/run-end.ts";
import { runStart } from "../../application/ledger/run-start.ts";
import { state as runState } from "../../application/ledger/state.ts";
import { unitUpsertBatch } from "../../application/ledger/unit-upsert-batch.ts";
import { unitUpsert } from "../../application/ledger/unit-upsert.ts";
import { verdictRecordBatch } from "../../application/ledger/verdict-record-batch.ts";
import { verdictRecord } from "../../application/ledger/verdict-record.ts";
import { waiverRecordBatch } from "../../application/ledger/waiver-record-batch.ts";
import { waiverRecord } from "../../application/ledger/waiver-record.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SEVERITIES } from "test-forge-contracts/codex";
import { EXIT_KINDS } from "test-forge-contracts/gates";
import { SCOPES } from "test-forge-contracts/project";
import { z } from "zod";

const UNIT_STATES = [
  "assigned",
  "drafted",
  "reviewed",
  "revised",
  "accepted",
  "abandoned",
] as const;

const FINDING_STATUSES = [
  "open",
  "fixed",
  "waived",
  "confirmed-defect",
  "confirmed-but-known",
  "rejected",
  "superseded",
] as const;

const SUBJECT_KINDS = [
  "file",
  "test",
  "finding",
  "mutant",
  "matrix-cell",
  "radius-node",
  "focus-item",
] as const;

const RECORDED_VERDICTS = [
  "pass",
  "violation",
  "not-applicable",
  "confirmed-defect",
  "confirmed-but-known",
  "not-a-defect",
] as const;

const MATRIX_CELL_STATES = ["empty", "covered", "not-applicable"] as const;

const WAIVER_KINDS = [
  "matrix-cell",
  "radius-node",
  "focus-line",
  "rule",
  "mutant",
  "finding",
  "test-value",
] as const;

const cwd = z
  .string()
  .describe("Absolute path inside the project the run belongs to.");

const runId = z
  .number()
  .int()
  .describe("Run identifier from ledger_run_start.");

const runStartInput = z
  .object({
    cwd,
    focus: z
      .string()
      .describe(
        "The human's run focus, one instruction per line. Each non-blank line becomes a focus item D9 maps a test against."
      ),
    scope: z
      .enum(SCOPES)
      .describe("Half of the corpus this run works on: backend or frontend."),
  })
  .strict();

const runEndInput = z
  .object({
    cwd,
    runId,
    exitKind: z
      .enum(EXIT_KINDS)
      .describe(
        "DONE when all ten predicates are true, BLOCKED when one question stops the run, STALLED when the vector stopped moving."
      ),
    exitReason: z
      .string()
      .describe("For BLOCKED, the one precise question for the human.")
      .optional(),
  })
  .strict();

const passRecordInput = z
  .object({
    cwd,
    runId,
    predicates: z
      .object({
        d1: z
          .boolean()
          .describe("SYNTAX: the units compile and pass static.")
          .optional(),
        d2: z
          .boolean()
          .describe(
            "CONFORMANCE: every applicable rule reached a pass verdict."
          )
          .optional(),
        d3: z
          .boolean()
          .describe("STABLE: the flake probe found no divergence.")
          .optional(),
        d4: z
          .boolean()
          .describe("VERIFIED: every red test carries a Noble Team verdict.")
          .optional(),
        d5: z
          .boolean()
          .describe(
            "MUTATION: no mutant survived without a signed equivalence claim."
          )
          .optional(),
        d6: z
          .boolean()
          .describe("VALUE: every kept test earns its place.")
          .optional(),
        d7: z
          .boolean()
          .describe("COMPLETE: no coverage matrix cell is empty.")
          .optional(),
        d8: z
          .boolean()
          .describe("RADIUS: no effect closure node is unresolved.")
          .optional(),
        d9: z
          .boolean()
          .describe("FOCUS: every focus line maps to a test.")
          .optional(),
        d10: z
          .boolean()
          .describe(
            "ESCALATION: no escalation raised on the run is still open."
          )
          .optional(),
      })
      .strict()
      .describe(
        "The ten predicates d1 through d10. A missing key counts as false."
      ),
  })
  .strict();

const unitItem = z
  .object({
    filePath: z
      .string()
      .describe("Test file this unit of work covers, one unit per file."),
    authorCallsign: z
      .string()
      .describe("The Spartan who owns this file.")
      .optional(),
    state: z
      .enum(UNIT_STATES)
      .describe("Where the unit stands in the operation.")
      .optional(),
  })
  .strict();

const unitUpsertInput = z.object({ cwd, runId, ...unitItem.shape }).strict();

const unitUpsertBatchInput = z
  .object({
    cwd,
    runId,
    units: z
      .array(unitItem)
      .min(1)
      .describe(
        "Every unit you are recording or moving, in one call. A whole assignment pass belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const findingItem = z
  .object({
    findingKey: z
      .string()
      .describe("Stable fingerprint of this finding, used to deduplicate it."),
    severity: z
      .enum(SEVERITIES)
      .describe("blocking stops the run; advisory only reports.")
      .optional(),
    title: z.string().describe("The finding in one sentence.").optional(),
    location: z
      .string()
      .describe("File and line, or test name, the finding sits at.")
      .optional(),
    evidence: z
      .string()
      .describe("What proves the finding, quoted from the source or the run.")
      .optional(),
    proposedFix: z
      .string()
      .describe("The change that would clear it.")
      .optional(),
    status: z
      .enum(FINDING_STATUSES)
      .describe("Where the finding stands. Defaults to open.")
      .optional(),
  })
  .strict();

const findingUpsertInput = z
  .object({ cwd, runId, ...findingItem.shape })
  .strict();

const findingUpsertBatchInput = z
  .object({
    cwd,
    runId,
    findings: z
      .array(findingItem)
      .min(1)
      .describe(
        "Every finding you are recording, in one call. A whole inspection pass belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const matrixCellInput = z
  .object({
    rowKey: z
      .string()
      .describe("Row key of the cell, which must be one of the rowKeys."),
    columnKey: z
      .string()
      .describe("Column key of the cell, which must be one of the columnKeys."),
    state: z
      .enum(MATRIX_CELL_STATES)
      .describe(
        "empty leaves the cell open, covered means a cited test asserts it, not-applicable means the dimension cannot exist on that row."
      ),
    testRef: z
      .string()
      .describe(
        "The test that covers the cell, shaped file::title. Required when state is covered."
      )
      .optional(),
  })
  .strict();

const matrixUpsertInput = z
  .object({
    cwd,
    runId,
    matrixKey: z
      .string()
      .describe("Key of this matrix, normally the unit id it belongs to."),
    rowKeys: z
      .array(z.string())
      .describe(
        "Every row key of the matrix, in order, such as R01 through R14. The full grid is materialised from these."
      ),
    columnKeys: z
      .array(z.string())
      .describe(
        "Every observable dimension crossed against the rows, such as return, mutations, externals and events."
      ),
    cells: z
      .array(matrixCellInput)
      .describe(
        "The cells whose state is already known. Any cell of the grid left out stays empty, which keeps D7 open."
      )
      .optional(),
  })
  .strict();

const verdictItem = z
  .object({
    subjectKind: z.enum(SUBJECT_KINDS).describe("What the verdict is about."),
    subjectRef: z
      .string()
      .describe(
        "Finding key, file path, test name, mutant id or cell reference, matching subjectKind."
      ),
    agentCallsign: z.string().describe("The agent who reached it.").optional(),
    post: z
      .string()
      .describe("The post the agent held, such as Inspector or Skeptic.")
      .optional(),
    ruleId: z
      .string()
      .describe("Rule the verdict was reached under, for an aspect verdict.")
      .optional(),
    verdict: z.enum(RECORDED_VERDICTS).describe("The verdict itself."),
    rubric: z
      .array(z.unknown())
      .describe("Rubric answers behind the verdict.")
      .optional(),
    sites: z.array(z.unknown()).describe("Cited lines or sites.").optional(),
    testRef: z
      .string()
      .describe(
        "The test that carries the subject, shaped file::title. Required on a focus-item pass, which is what maps the focus line for D9."
      )
      .optional(),
  })
  .strict();

const verdictRecordInput = z
  .object({ cwd, runId, ...verdictItem.shape })
  .strict();

const verdictRecordBatchInput = z
  .object({
    cwd,
    runId,
    verdicts: z
      .array(verdictItem)
      .min(1)
      .describe(
        "Every verdict you are recording, in one call. A whole focus mapping or a whole failure ruling belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const overturnRecordInput = z
  .object({
    cwd,
    verdictId: z
      .number()
      .int()
      .describe("Identifier of the verdict being overturned."),
    overturnedBy: z.string().describe("Defaults to human.").optional(),
    correctVerdict: z
      .enum(RECORDED_VERDICTS)
      .describe("The verdict that should have been reached."),
    reason: z.string().describe("Why the original verdict was wrong."),
  })
  .strict();

const waiverItem = z
  .object({
    kind: z.enum(WAIVER_KINDS).describe("What is being waived."),
    ref: z
      .union([z.string(), z.number()])
      .describe(
        "Reference by kind: matrix-cell uses matrixKey|rowKey|columnKey, radius-node uses the node reference, focus-line uses the line number, mutant uses the mutant id, finding uses the finding key."
      ),
    reason: z.string().describe("Why the gap is acceptable."),
    signedBy: z.string().describe("Defaults to human.").optional(),
  })
  .strict();

const waiverRecordInput = z
  .object({ cwd, runId, ...waiverItem.shape })
  .strict();

const waiverRecordBatchInput = z
  .object({
    cwd,
    runId,
    waivers: z
      .array(waiverItem)
      .min(1)
      .describe(
        "Every waiver the human signed, in one call. A whole set of matrix cells or focus lines belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const findingKnownInput = z
  .object({
    cwd,
    fingerprint: z
      .string()
      .describe("The finding key to look up across every run of this project."),
  })
  .strict();

const stateInput = z
  .object({ cwd, runId, page: listPageInput.optional() })
  .strict();

export const registerLedgerTools = (server: McpServer): void => {
  server.registerTool(
    "ledger_run_start",
    {
      title: "Open a run",
      description: [
        "Opens a run and splits the human's focus into focus items, one per non-blank line, so D9 has something to map tests against. Returns the run id every other ledger tool needs.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- focus (string): the human's run focus, one instruction per line.",
        "- scope ('backend' | 'frontend'): half of the corpus this run works on.",
        "",
        "Returns: { projectKey: string, runId: number, scope: string, focus: string, focusItems: number, startedAt: string }.",
        "",
        "Examples:",
        "- Use it once, at the top of an operation, before any unit, verdict or finding is recorded.",
        "- Do NOT use it to resume an operation that already has a run id: call ledger_state with that id.",
        "- Do NOT call it a second time inside one operation; a second call opens a second run and splits the evidence.",
        "",
        "Error handling: an unresolvable cwd fails the call. A scope outside backend and frontend is rejected by the schema. A focus of only blank lines opens the run with focusItems 0, which leaves D9 with nothing to satisfy.",
      ].join("\n"),
      inputSchema: runStartInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, focus, scope }) =>
      respondAsync(
        "The result is one opened run and cannot be narrowed. Open one run per operation.",
        () => runStart({ cwd, focus, scope })
      )
  );

  server.registerTool(
    "ledger_run_end",
    {
      title: "Close a run with its exit",
      description: [
        "Closes a run with its exit kind and the reason behind it, and stamps the end time.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier from ledger_run_start.",
        "- exitKind ('DONE' | 'BLOCKED' | 'STALLED'): DONE when all ten predicates are true, BLOCKED when one question stops the run, STALLED when the vector stopped moving.",
        "- exitReason (string, optional): for BLOCKED, the one precise question for the human.",
        "",
        "Returns: { projectKey: string, runId: number, exitKind: string | null, exitReason: string | null, startedAt: string, endedAt: string | null }.",
        "",
        "Examples:",
        "- Use it once the work list is empty and gates_evaluate reports allTrue, with exitKind DONE.",
        "- Use it with BLOCKED and one question when the run cannot proceed without the human.",
        "- Do NOT use it to decide whether the run is done: call gates_evaluate, which derives that from evidence.",
        "- Do NOT use it to record a pass of the loop: call ledger_pass_record.",
        "",
        "Error handling: an unknown runId fails the call. An exitKind outside the three is rejected by the schema. Closing an already closed run overwrites the exit and is not an error.",
      ].join("\n"),
      inputSchema: runEndInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, exitKind, exitReason }) =>
      respondAsync(
        "The result is one closed run and cannot be narrowed. Close one run per call.",
        () => runEnd({ cwd, runId: id, exitKind, exitReason })
      )
  );

  server.registerTool(
    "ledger_pass_record",
    {
      title: "Store one pass of the done vector",
      description: [
        "Stores the ten done-vector booleans as the next pass of a run. Returns the pass number and a stalled flag that is true when this vector is identical to the previous pass.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- predicates (object): the ten booleans d1 through d10. A missing key counts as false.",
        "",
        "Returns: { projectKey: string, runId: number, passNo: number, predicates: { d1..d10: boolean }, failing: string[], allGreen: boolean, stalled: boolean, previousPassNo: number | null }.",
        "",
        "Examples:",
        "- Use it to record a vector the caller derived outside the gates, such as a replayed historical pass.",
        "- Do NOT use it in the normal operation loop: gates_evaluate derives the vector from evidence and records the pass itself, so calling both double-counts the passes.",
        "- Do NOT use it to read the passes already stored: call ledger_state.",
        "",
        "Error handling: an unknown runId fails the call. A key outside d1 through d9 is rejected by the schema. Two identical passes in a row are not an error; the second comes back with stalled true, which is the signal the loop stopped moving.",
      ].join("\n"),
      inputSchema: passRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, predicates }) =>
      respondAsync(
        "The result is one pass row and cannot be narrowed. Record one pass per call.",
        () => passRecord({ cwd, runId: id, predicates })
      )
  );

  server.registerTool(
    "ledger_unit_upsert",
    {
      title: "Record or move a unit of work",
      description: [
        "Records or moves a unit of work: one test file, one owning author, one state. Writing the same run and file again updates the row instead of adding a second unit.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- filePath (string): the test file this unit covers.",
        "- authorCallsign (string, optional): the Spartan who owns this file.",
        "- state ('assigned' | 'drafted' | 'reviewed' | 'revised' | 'accepted' | 'abandoned', optional): where the unit stands.",
        "",
        "Returns: { projectKey: string, runId: number, unitId: number, filePath: string, authorCallsign: string, state: string }.",
        "",
        "Examples:",
        "- Use it for a single late unit, such as one file abandoned mid-pass.",
        "- Do NOT use it once per file over a set of files: that is one model turn per file. Call ledger_unit_upsert_batch with every unit in one call.",
        "- Do NOT use it to record what a review found: call ledger_verdict_record for the verdict and ledger_finding_upsert for the defect.",
        "- Do NOT use it to list the units of a run: call ledger_state.",
        "",
        "Error handling: an unknown runId fails the call. A state outside the six is rejected by the schema. Upserting the same file twice is not an error; the row is updated in place.",
      ].join("\n"),
      inputSchema: unitUpsertInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, filePath, authorCallsign, state }) =>
      respondAsync(
        "The result is one unit and cannot be narrowed. Upsert one file per call.",
        () => unitUpsert({ cwd, runId: id, filePath, authorCallsign, state })
      )
  );

  server.registerTool(
    "ledger_unit_upsert_batch",
    {
      title: "Record or move every unit of work in one call",
      description: [
        "Records or moves many units in one call and answers with a summary instead of one row per unit. Each entry is written exactly as ledger_unit_upsert writes it, and an entry that fails is reported without stopping the rest.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- units (array): every { filePath, authorCallsign?, state? } you are recording or moving.",
        "- page (object, optional): { list: 'units' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, storedCount, failedCount, units: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it to assign every file of a pass to its author in one call, then again to move them all to drafted.",
        "- Use groups to read the state distribution without opening a list.",
        "- Do NOT loop ledger_unit_upsert over the files of a pass; one call per file costs a model turn per file.",
        "- Do NOT use it to list the units of a run: call ledger_state.",
        "",
        "Truncation: the summary is bounded whatever the unit count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unknown runId fails every entry, and each failure lands in failures with the file path and the reason. A repeated file path is not an error; the row is updated in place.",
      ].join("\n"),
      inputSchema: unitUpsertBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, units, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await unitUpsertBatch({ cwd, runId: id, units });
          return {
            requested: batch.requested,
            storedCount: batch.storedCount,
            failedCount: batch.failedCount,
            units: listView({
              kind: "ledger-units",
              items: batch.units,
              label: (unit) =>
                `${unit.state} ${unit.filePath} (${unit.authorCallsign})`,
              group: (unit) => unit.state,
              page: pageFor("units", page),
            }),
            failures: listView({
              kind: "ledger-unit-failures",
              items: batch.failures,
              label: (failure) => `${failure.ref}: ${failure.error}`,
              group: (failure) => failure.error,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "ledger_finding_upsert",
    {
      title: "Record a finding, deduplicated",
      description: [
        "Records a finding, deduplicating on findingKey within the run. A second report of the same key updates the existing row instead of creating a duplicate, so two agents reporting one defect leave one finding.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- findingKey (string): stable fingerprint of this finding.",
        "- severity ('blocking' | 'advisory', optional): blocking stops the run.",
        "- title (string, optional): the finding in one sentence.",
        "- location (string, optional): file and line, or test name.",
        "- evidence (string, optional): what proves it.",
        "- proposedFix (string, optional): the change that would clear it.",
        "- status (finding status, optional): open, fixed, waived, confirmed-defect, confirmed-but-known, rejected or superseded. Defaults to open.",
        "",
        "Returns: { projectKey: string, runId: number, findingId: number, findingKey: string, severity: string, status: string, deduplicated: boolean }.",
        "",
        "Examples:",
        "- Use it the moment a reviewer finds a single defect, before any verdict is written about it.",
        "- Use the same findingKey across agents so one defect stays one row.",
        "- Do NOT use it once per violation over an inspection pass: that is one model turn per finding. Call ledger_finding_upsert_batch with every finding in one call.",
        "- Do NOT use it to confirm or reject the finding: call ledger_verdict_record with subjectKind finding, which moves the status.",
        "- Do NOT use it to ask whether this defect happened before: call ledger_finding_known.",
        "",
        "Error handling: an unknown runId fails the call. A severity or status outside the allowed set is rejected by the schema. A repeated findingKey is not an error; it returns deduplicated true.",
      ].join("\n"),
      inputSchema: findingUpsertInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      cwd,
      runId: id,
      findingKey,
      severity,
      title,
      location,
      evidence,
      proposedFix,
      status,
    }) =>
      respondAsync(
        "The result is one finding and cannot be narrowed. Report one finding per call.",
        () =>
          findingUpsert({
            cwd,
            runId: id,
            findingKey,
            severity,
            title,
            location,
            evidence,
            proposedFix,
            status,
          })
      )
  );

  server.registerTool(
    "ledger_finding_upsert_batch",
    {
      title: "Record every finding of a pass in one call",
      description: [
        "Records many findings in one call and answers with a summary instead of one row per finding. Each entry deduplicates on findingKey exactly as ledger_finding_upsert does, and an entry that fails is reported without stopping the rest.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- findings (array): every { findingKey, severity?, title?, location?, evidence?, proposedFix?, status? } you are recording.",
        "- page (object, optional): { list: 'findings' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, storedCount, failedCount, blockingCount, deduplicatedCount, findings: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it to land every violation an inspection pass produced, in one call.",
        "- Use blockingCount and the groups to see whether the pass can proceed without opening a list.",
        "- Do NOT loop ledger_finding_upsert over the violations of a pass; one call per violation costs a model turn per violation.",
        "- Do NOT use it to confirm or reject the findings: call ledger_verdict_record_batch with subjectKind finding.",
        "",
        "Truncation: the summary is bounded whatever the finding count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unknown runId fails every entry, and each failure lands in failures with the finding key and the reason. A repeated findingKey is not an error; it counts in deduplicatedCount.",
      ].join("\n"),
      inputSchema: findingUpsertBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, findings, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await findingUpsertBatch({ cwd, runId: id, findings });
          return {
            requested: batch.requested,
            storedCount: batch.storedCount,
            failedCount: batch.failedCount,
            blockingCount: batch.blockingCount,
            deduplicatedCount: batch.deduplicatedCount,
            findings: listView({
              kind: "ledger-findings",
              items: batch.findings,
              label: (finding) =>
                `${finding.severity} ${finding.status} ${finding.findingKey}`,
              group: (finding) => finding.severity,
              page: pageFor("findings", page),
            }),
            failures: listView({
              kind: "ledger-finding-failures",
              items: batch.failures,
              label: (failure) => `${failure.ref}: ${failure.error}`,
              group: (failure) => failure.error,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "ledger_matrix_upsert",
    {
      title: "Write a coverage matrix into the ledger",
      description: [
        "Writes one coverage matrix into the run: it materialises the whole grid of rowKeys crossed with columnKeys as empty cells, then sets the state of the cells you already know. This is the only path into the coverage matrix, so a matrix the Quartermaster produced but nobody wrote here leaves D7 with nothing to read.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- matrixKey (string): key of this matrix, normally the unit id it belongs to.",
        "- rowKeys (string[]): every row key, such as R01 through R14.",
        "- columnKeys (string[]): every observable dimension, such as return, mutations, externals and events.",
        "- cells (array, optional): the cells whose state is known, each { rowKey, columnKey, state: 'empty' | 'covered' | 'not-applicable', testRef? }.",
        "",
        "Returns: { projectKey: string, runId: number, matrixKey: string, rowCount: number, columnCount: number, totalCells: number, emptyCells: number, states: { empty: number, covered: number, 'not-applicable': number, waived: number } }.",
        "",
        "Examples:",
        "- Use it once the Quartermaster returns a matrix, passing his rows and his four columns, so the grid exists and D7 has cells to count.",
        "- Use it again as tests land, passing only the cells that turned covered with the test that covers them; the cells left out keep the state they already hold.",
        "- Do NOT use it to waive a cell that will never be filled: call ledger_waiver_record with kind matrix-cell and ref matrixKey|rowKey|columnKey.",
        "- Do NOT use it to read what is still empty: call gates_status or ledger_state.",
        "",
        "Error handling: an unknown runId fails the call. A blank matrixKey, an empty or repeating axis, or a cell whose rowKey or columnKey is not on the declared axes fails the call before anything is written. A cell marked covered without a testRef fails, because an uncited covered cell is D7 passing on nothing.",
      ].join("\n"),
      inputSchema: matrixUpsertInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, matrixKey, rowKeys, columnKeys, cells }) =>
      respondAsync(
        "The result counts one matrix and cannot be narrowed. Write one matrixKey per call.",
        () =>
          matrixUpsert({
            cwd,
            runId: id,
            matrixKey,
            rowKeys,
            columnKeys,
            cells,
          })
      )
  );

  server.registerTool(
    "ledger_verdict_record",
    {
      title: "Append a verdict on one subject",
      description: [
        "Appends a verdict on one subject by one agent. A verdict on a finding also moves that finding's status: confirmed-defect and confirmed-but-known keep it red and accounted for, and not-a-defect rejects it. A pass on a focus-item maps that focus line to the cited test, which is the honest way D9 goes green without waiving the line.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- subjectKind ('file' | 'test' | 'finding' | 'mutant' | 'matrix-cell' | 'radius-node' | 'focus-item'): what the verdict is about.",
        "- subjectRef (string): finding key, file path, test name, mutant id or cell reference, matching subjectKind. For a focus-item it is the focus line number.",
        "- agentCallsign (string, optional): the agent who reached it.",
        "- post (string, optional): the post the agent held, such as Inspector or Skeptic.",
        "- ruleId (string, optional): the rule the verdict was reached under, for an aspect verdict.",
        "- verdict ('pass' | 'violation' | 'not-applicable' | 'confirmed-defect' | 'confirmed-but-known' | 'not-a-defect'): the verdict itself.",
        "- rubric (array, optional): rubric answers behind the verdict.",
        "- sites (array, optional): cited lines or sites.",
        "- testRef (string, optional): the test that carries the subject, shaped file::title. Required on a focus-item pass.",
        "",
        "Returns: { projectKey: string, runId: number, verdictId: number, subjectKind: string, subjectRef: string, verdict: string, findingStatus: string | null, focusResolution: string | null }. findingStatus is the status the linked finding was moved to, and focusResolution is 'mapped' when a focus line was mapped; both are null when the subject is of another kind.",
        "",
        "Examples:",
        "- Use it to record that a red test is a real defect, which is what lets D4 count that red as accounted for.",
        "- Use it with ruleId and rubric to record an aspect verdict a reviewer reached under one codex rule.",
        "- Use it with subjectKind 'focus-item', the line number as subjectRef, verdict 'pass' and testRef to map a focus line the suite genuinely carries.",
        "- Do NOT use it once per focus line or once per failing test: that is one model turn per subject. Call ledger_verdict_record_batch with every verdict in one call.",
        "- Do NOT use it to create the defect itself: call ledger_finding_upsert first, then cite its key as subjectRef.",
        "- Do NOT use it to correct a verdict already recorded: call ledger_overturn_record, which keeps the original row.",
        "- Do NOT waive a focus line the tests already carry: waiving is for a line no test will ever map.",
        "",
        "Error handling: an unknown runId fails the call. A subjectKind or verdict outside the allowed set is rejected by the schema. A subjectRef naming a finding that does not exist records the verdict with findingStatus null rather than failing. A focus-item pass without testRef fails, and a subjectRef that is not a focus line of the run fails naming the line, because a silent no-op there is what left D9 with no writer.",
      ].join("\n"),
      inputSchema: verdictRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({
      cwd,
      runId: id,
      subjectKind,
      subjectRef,
      agentCallsign,
      post,
      ruleId,
      verdict,
      rubric,
      sites,
      testRef,
    }) =>
      respondAsync(
        "The result is one verdict and cannot be narrowed. Record one subject per call.",
        () =>
          verdictRecord({
            cwd,
            runId: id,
            subjectKind,
            subjectRef,
            agentCallsign,
            post,
            ruleId,
            verdict,
            rubric,
            sites,
            testRef,
          })
      )
  );

  server.registerTool(
    "ledger_verdict_record_batch",
    {
      title: "Append every verdict of a pass in one call",
      description: [
        "Appends many verdicts in one call and answers with a summary instead of one row per verdict. Each entry is written exactly as ledger_verdict_record writes it, including the finding status move and the focus mapping, and an entry that fails is reported without stopping the rest.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- verdicts (array): every { subjectKind, subjectRef, verdict, agentCallsign?, post?, ruleId?, rubric?, sites?, testRef? } you are recording.",
        "- page (object, optional): { list: 'verdicts' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, recordedCount, failedCount, focusMappedCount, verdicts: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it to map every focus line to the test that carries it, in one call, which is what closes D9.",
        "- Use it to land a whole verification pass, one entry per failing test.",
        "- Do NOT loop ledger_verdict_record over the focus lines or the failures; one call per subject costs a model turn per subject.",
        "- Do NOT use it to correct verdicts already recorded: call ledger_overturn_record, which keeps the original rows.",
        "",
        "Truncation: the summary is bounded whatever the verdict count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a focus-item pass without testRef, and a subjectRef that is not a focus line of the run, land in failures with the reason while the other entries still record. An unknown runId fails every entry.",
      ].join("\n"),
      inputSchema: verdictRecordBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, verdicts, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await verdictRecordBatch({ cwd, runId: id, verdicts });
          return {
            requested: batch.requested,
            recordedCount: batch.recordedCount,
            failedCount: batch.failedCount,
            focusMappedCount: batch.focusMappedCount,
            verdicts: listView({
              kind: "ledger-verdicts",
              items: batch.verdicts,
              label: (row) =>
                `${row.verdict} ${row.subjectKind}::${row.subjectRef}`,
              group: (row) => row.verdict,
              page: pageFor("verdicts", page),
            }),
            failures: listView({
              kind: "ledger-verdict-failures",
              items: batch.failures,
              label: (failure) => `${failure.ref}: ${failure.error}`,
              group: (failure) => failure.error,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "ledger_overturn_record",
    {
      title: "Record the human overturning a verdict",
      description: [
        "Records the human overturning a verdict, with the correct verdict and the reason. The original verdict row stays, so the disagreement is auditable and the board can score the agent that got it wrong.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- verdictId (integer): identifier of the verdict being overturned, from ledger_verdict_record.",
        "- overturnedBy (string, optional): defaults to human.",
        "- correctVerdict ('pass' | 'violation' | 'not-applicable' | 'confirmed-defect' | 'confirmed-but-known' | 'not-a-defect'): what should have been reached.",
        "- reason (string): why the original verdict was wrong.",
        "",
        "Returns: { projectKey: string, overturnId: number, verdictId: number, originalVerdict: string, correctVerdict: string, findingStatus: string | null }.",
        "",
        "Examples:",
        "- Use it when the human reads a review and disagrees with the agent that signed it.",
        "- Do NOT use it to change a verdict an agent should re-reach itself: append a new verdict with ledger_verdict_record.",
        "- Do NOT use it to waive a gap the run cannot close: call ledger_waiver_record.",
        "",
        "Error handling: an unknown verdictId fails the call. A correctVerdict outside the allowed set is rejected by the schema. When the overturned verdict pointed at a finding, that finding's status moves with it and comes back in findingStatus.",
      ].join("\n"),
      inputSchema: overturnRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, verdictId, overturnedBy, correctVerdict, reason }) =>
      respondAsync(
        "The result is one overturn and cannot be narrowed. Overturn one verdict per call.",
        () =>
          overturnRecord({
            cwd,
            verdictId,
            overturnedBy,
            correctVerdict,
            reason,
          })
      )
  );

  server.registerTool(
    "ledger_waiver_record",
    {
      title: "Record a signed waiver",
      description: [
        "Records a signed waiver, which is what lets a predicate count a gap as accounted for instead of open. Writing the same run, kind and reference again updates the standing waiver.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- kind ('matrix-cell' | 'radius-node' | 'focus-line' | 'rule' | 'mutant' | 'finding' | 'test-value'): what is being waived.",
        "- ref (string | number): reference by kind - matrix-cell uses matrixKey|rowKey|columnKey, radius-node uses the node reference, focus-line uses the line number, mutant uses the mutant id, finding uses the finding key.",
        "- reason (string): why the gap is acceptable.",
        "- signedBy (string, optional): defaults to human.",
        "",
        "Returns: { projectKey: string, runId: number, waiverId: number, kind: string, ref: string, signedBy: string, createdAt: string }.",
        "",
        "Examples:",
        "- Use it when a coverage cell cannot be filled and the human signs off on the hole.",
        "- Use it with kind mutant when a surviving mutant is genuinely equivalent and the claim was upheld.",
        "- Do NOT use it once per empty cell or once per open node: that is one model turn per gap. Call ledger_waiver_record_batch with every waiver in one call.",
        "- Do NOT use it to dismiss a finding a reviewer got wrong: call ledger_verdict_record with not-a-defect.",
        "- Do NOT use it to close a run: call ledger_run_end.",
        "",
        "Error handling: an unknown runId fails the call. A kind outside the seven is rejected by the schema. A blank reason fails the call, because an unexplained waiver is what the ledger exists to prevent.",
      ].join("\n"),
      inputSchema: waiverRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, kind, ref, reason, signedBy }) =>
      respondAsync(
        "The result is one waiver and cannot be narrowed. Sign one reference per call.",
        () => waiverRecord({ cwd, runId: id, kind, ref, reason, signedBy })
      )
  );

  server.registerTool(
    "ledger_waiver_record_batch",
    {
      title: "Record every signed waiver in one call",
      description: [
        "Records many signed waivers in one call and answers with a summary instead of one row per waiver. Each entry is written exactly as ledger_waiver_record writes it, and an entry that fails is reported without stopping the rest.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- waivers (array): every { kind, ref, reason, signedBy? } the human signed.",
        "- page (object, optional): { list: 'waivers' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, signedCount, failedCount, waivers: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it for the whole set of matrix cells the human signed off in one sitting.",
        "- Use groups to see the waiver kinds without opening a list.",
        "- Do NOT loop ledger_waiver_record over the gaps of a gate; one call per gap costs a model turn per gap.",
        "- Do NOT use it to dismiss findings a reviewer got wrong: call ledger_verdict_record_batch with not-a-defect.",
        "",
        "Truncation: the summary is bounded whatever the waiver count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a blank reason lands that entry in failures while the others still record, because an unexplained waiver is what the ledger exists to prevent. An unknown runId fails every entry.",
      ].join("\n"),
      inputSchema: waiverRecordBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, waivers, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await waiverRecordBatch({ cwd, runId: id, waivers });
          return {
            requested: batch.requested,
            signedCount: batch.signedCount,
            failedCount: batch.failedCount,
            waivers: listView({
              kind: "ledger-waivers",
              items: batch.waivers,
              label: (waiver) =>
                `${waiver.kind} ${waiver.ref} (${waiver.signedBy})`,
              group: (waiver) => waiver.kind,
              page: pageFor("waivers", page),
            }),
            failures: listView({
              kind: "ledger-waiver-failures",
              items: batch.failures,
              label: (failure) => `${failure.ref}: ${failure.error}`,
              group: (failure) => failure.error,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "ledger_finding_known",
    {
      title: "Has this failed here before",
      description: [
        "Indexed lookup on the finding fingerprint across every run of this project: has this failed before? Returns every prior occurrence with the run it came from, the verdicts reached on it, and any war game recorded under the same key.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- fingerprint (string): the finding key to look up.",
        "",
        "Returns: { projectKey: string, fingerprint: string, known: boolean, occurrenceCount: number, lastStatus: string | null, lastSeenAt: string | null, occurrences: Array<{ findingId, runId, severity, title, location, status, createdAt, runFocus, runScope, runExit }>, verdicts: Array<{ verdictId, runId, agentCallsign, post, ruleId, verdict, createdAt }>, warGame: { scenarioId, squad, post, aspect, status, rootCause, createdAt } | null }.",
        "",
        "Examples:",
        "- Use it before writing a finding, to decide between confirmed-defect and confirmed-but-known.",
        "- Use it when a red test looks familiar, to read what the last run decided about it.",
        "- Do NOT use it to record a new occurrence: call ledger_finding_upsert.",
        "- Do NOT use it to read the findings of the current run: call ledger_state.",
        "",
        "Error handling: an unknown fingerprint is not an error; it returns known false with empty lists. An unresolvable cwd fails the call.",
      ].join("\n"),
      inputSchema: findingKnownInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, fingerprint }) =>
      respondAsync(
        "Look up one fingerprint per call. A fingerprint with a long history cannot be narrowed further.",
        () => findingKnown({ cwd, fingerprint })
      )
  );

  server.registerTool(
    "ledger_state",
    {
      title: "The whole current state of a run",
      description: [
        "The whole current state of a run in one object: units, every pass and the latest done vector, findings with their verdicts, waivers, empty matrix cells, unresolved radius nodes, unmapped focus lines, surviving mutants, and the open blocks that keep the run out of DONE.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- runId (integer): run identifier.",
        "- page (object, optional): { list: 'units' | 'findings' | 'waivers' | 'verdicts', offset, limit } opens a window of one list. Omit it and only the summaries come back.",
        "",
        "Returns: { projectKey, run: { runId, focus, scope, startedAt, endedAt, exitKind, exitReason }, unitCounts: Record<string, number>, passes, latestPass, coverage: { emptyCells }, radius: { unresolvedNodes }, focus: { unmapped }, mutation: { surviving, pending, total }, openBlocks: Array<{ predicate, reason, refs }>, units: ListView, findings: ListView, waivers: ListView, verdicts: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it to resume an operation and see what is already recorded before assigning more work.",
        "- Use it to read openBlocks when a run will not go green and you need the refs behind each block.",
        "- Use unitCounts and the findings groups to judge the run without opening a list at all.",
        "- Do NOT use it to decide whether the predicates are true: call gates_evaluate, which derives them from evidence rather than reporting what was stored.",
        "- Do NOT use it to look a defect up across runs: call ledger_finding_known.",
        "",
        "Truncation: the four long lists come back as bounded summaries, so a long run no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unknown runId fails the call naming the run. A run with nothing recorded yet is not an error; the lists come back empty and latestPass is null.",
      ].join("\n"),
      inputSchema: stateInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const current = await runState({ cwd, runId: id });
          return {
            ...current,
            units: listView({
              kind: "state-units",
              items: current.units,
              label: (unit) => `${unit.state} ${unit.filePath}`,
              group: (unit) => unit.state,
              page: pageFor("units", page),
            }),
            findings: listView({
              kind: "state-findings",
              items: current.findings,
              label: (finding) =>
                `${finding.severity} ${finding.status} ${finding.findingKey}`,
              group: (finding) => `${finding.severity}/${finding.status}`,
              page: pageFor("findings", page),
            }),
            waivers: listView({
              kind: "state-waivers",
              items: current.waivers,
              label: (waiver) => `${waiver.kind} ${waiver.ref}`,
              group: (waiver) => waiver.kind,
              page: pageFor("waivers", page),
            }),
            verdicts: listView({
              kind: "state-verdicts",
              items: current.verdicts,
              label: (verdict) =>
                `${verdict.verdict} ${verdict.subjectKind}::${verdict.subjectRef}`,
              group: (verdict) => verdict.verdict,
              page: pageFor("verdicts", page),
            }),
          };
        }
      )
  );
};
