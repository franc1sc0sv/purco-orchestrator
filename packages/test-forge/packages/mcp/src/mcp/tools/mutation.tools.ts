import { listView } from "../../application/listing/list-view.ts";
import { mutationApplyAndRun } from "../../application/mutation/apply-and-run.ts";
import { mutationAttribution } from "../../application/mutation/attribution.ts";
import { mutationBatchRun } from "../../application/mutation/batch-run.ts";
import { mutationEquivalenceRecord } from "../../application/mutation/equivalence-record.ts";
import { mutationGenerate } from "../../application/mutation/generate.ts";
import { mutationSurvivors } from "../../application/mutation/survivors.ts";
import { listPageInput, pageFor, pageInput } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const mutationGenerateInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    files: z
      .array(z.string())
      .describe("Source files to mutate, repository relative or absolute."),
    runId: z
      .number()
      .int()
      .describe(
        "Run to persist the mutants into. Without it the mutants come back without ids and nothing is stored."
      )
      .optional(),
    page: pageInput.optional(),
  })
  .strict();

const mutationApplyAndRunInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    mutantId: z
      .number()
      .int()
      .describe("Identifier of a persisted mutant from mutation_generate."),
    tests: z
      .array(z.string())
      .describe("Test files to run against the mutant, and nothing else."),
    command: z
      .string()
      .describe(
        "Override the test command. Defaults to 'npx vitest run --reporter=json <tests>'."
      )
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .describe("Hard timeout in milliseconds. Default 600000.")
      .optional(),
    bail: z
      .boolean()
      .describe(
        "Fast triage: stop the runner at the first failing test. Default false. Turning it on costs the attribution: only the first killing test is recorded, so a mutant killed by three tests names one, the other two look like they killed nothing, and a test that earns its place can be judged worthless. Every kill row written under bail is marked attributionComplete false, and D6 then refuses a unique-kill verdict until the mutant is run again without it. Turn it on only to learn whether a mutant dies at all."
      )
      .optional(),
  })
  .strict();

const mutationBatchRunInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    mutantIds: z
      .array(z.number().int())
      .describe("Persisted mutants from mutation_generate, run as one batch."),
    tests: z
      .array(z.string())
      .describe("Test files to run against every mutant, and nothing else."),
    campaignId: z
      .number()
      .int()
      .describe(
        "Campaign whose lanes run the batch. Without it the newest ready campaign for this repository is used."
      )
      .optional(),
    concurrency: z
      .number()
      .int()
      .describe(
        "How many lanes to use, capped by the lanes the campaign built. Default every lane."
      )
      .optional(),
    command: z
      .string()
      .describe("Override the test command. Defaults to 'npx vitest run'.")
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .describe("Hard timeout per mutant in milliseconds. Default 600000.")
      .optional(),
    bail: z
      .boolean()
      .describe(
        "Fast triage: stop each run at the first failing test. Default false. Turning it on costs the attribution: only the first killing test of each mutant is recorded, so the tests that run later look like they killed nothing and a test that earns its place can be judged worthless. Every kill row written under bail is marked attributionComplete false, and D6 then refuses a unique-kill verdict until the batch is run again without it. Turn it on only to learn which mutants die at all."
      )
      .optional(),
    seedCopyRetries: z
      .number()
      .int()
      .describe(
        "How many times a mutant whose run failed on the environment rather than on the code is retried. Default 2."
      )
      .optional(),
    staggerMs: z
      .number()
      .int()
      .describe(
        "Delay between lane starts, which spreads the per test database copies apart. Default 750."
      )
      .optional(),
    includeKills: z
      .boolean()
      .describe(
        "Return the killing tests inline. Default false, because the kills are persisted and mutation_attribution reads them."
      )
      .optional(),
    refreshLanes: z
      .boolean()
      .describe(
        "Replay the current working tree into every lane before the batch. Default false, which instead refuses the batch when the working tree changed since the campaign started."
      )
      .optional(),
    minimumFreeGb: z
      .number()
      .describe("Disk headroom floor in GiB. Default 4.")
      .optional(),
    maximumContainers: z
      .number()
      .int()
      .describe("Running container ceiling. Default 40.")
      .optional(),
    reuseProcess: z
      .boolean()
      .describe(
        "Hold one vitest process open for a small group of mutants instead of paying node and vitest startup for every mutant. Default false, because the unbounded form of this is what made an earlier tool report different mutation scores for the same run."
      )
      .optional(),
    reuseBatchSize: z
      .number()
      .int()
      .describe(
        "How many mutants one held process runs before it is discarded and a fresh one is started. Default 5, ceiling 25. Only read when reuseProcess is true."
      )
      .optional(),
    page: pageInput.optional(),
  })
  .strict();

const mutationSurvivorsInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    runId: z.number().int().describe("Run whose mutants are counted."),
    page: listPageInput.optional(),
  })
  .strict();

const mutationEquivalenceRecordInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    mutantId: z
      .number()
      .int()
      .describe("Mutant the claim is about, normally a survivor."),
    claimedBy: z.string().describe("Who claims the mutant is equivalent."),
    argument: z
      .string()
      .describe("Why the mutant cannot change any observable behaviour."),
    refutedBy: z.string().describe("Who refuted the claim.").optional(),
    refutation: z
      .string()
      .describe("The behaviour the claim missed.")
      .optional(),
    upheld: z
      .boolean()
      .describe("Whether the claim stands after review.")
      .optional(),
    signedBy: z
      .string()
      .describe(
        "Human signature. An upheld claim only leaves the survivor list once it is signed."
      )
      .optional(),
  })
  .strict();

const mutationAttributionInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    runId: z.number().int().describe("Run whose kills are attributed."),
    tests: z
      .array(z.string())
      .describe(
        "Roster of every test in scope, as file::title, so the ones that killed nothing can be named."
      )
      .optional(),
    page: listPageInput.optional(),
  })
  .strict();

export const registerMutationTools = (server: McpServer): void => {
  server.registerTool(
    "mutation_generate",
    {
      title: "Produce every applicable mutant",
      description: [
        "Reads the given source files and produces every applicable mutant, line by line: boundary swap, condition flip, guard removal, empty result, argument swap, await removal, enum shift and date shift. Enum members and literals are pooled from the files and from what they import, so a shift lands on a real neighbour.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- files (string[]): source files to mutate.",
        "- runId (integer, optional): persist the mutants and return their ids.",
        "- page (object, optional): { offset, limit } opens a window of the mutants. Omit it and only the summary comes back.",
        "",
        "Returns: { counts: { total } and one count per operator, persisted: boolean, mutants: ListView }. The ListView carries { total, groups by operator, sample, handle, page?, items? } and its handle path is a JSON file holding every mutant, ids included when runId was supplied.",
        "",
        "Examples:",
        "- Use it with a runId before mutation_batch_run, which needs persisted mutant ids.",
        "- Use it without a runId to size the work before committing to a run.",
        "- Use counts and groups to size the batch, and read the handle file when you need every mutant.",
        "- Do NOT use it to run mutants: call mutation_batch_run.",
        "- Do NOT use it to learn which mutants are still alive: call mutation_survivors.",
        "",
        "Truncation: the summary is bounded whatever the file count, so the whole source line of every mutant no longer lands in the reply. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a file that cannot be read is skipped silently and contributes no mutants, so check counts.total against what you expected. Re-generating for the same runId returns the existing ids instead of duplicating.",
      ].join("\n"),
      inputSchema: mutationGenerateInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, files, runId, page }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for every mutant.",
        async () => {
          const generated = await mutationGenerate({ cwd, files, runId });
          return {
            counts: generated.counts,
            persisted: generated.persisted,
            mutants: listView({
              kind: "mutants",
              items: generated.mutants,
              label: (mutant) =>
                `${mutant.operator} ${mutant.file}:${mutant.line}`,
              group: (mutant) => mutant.operator,
              page,
            }),
          };
        }
      )
  );

  server.registerTool(
    "mutation_apply_and_run",
    {
      title: "Run one mutant in a throwaway worktree",
      description: [
        "Checks first that the mutant can compile at all, and if it cannot records outcome 'unviable' without running anything. Otherwise creates a throwaway git worktree, replays the uncommitted working tree into it, applies one mutant there, runs only the given tests, records the outcome and any killing tests, then removes the worktree. The real working tree is never touched.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- mutantId (integer): a persisted mutant from mutation_generate.",
        "- tests (string[]): the test files to run, and nothing else.",
        "- command (string, optional): override the test command.",
        "- timeoutMs (integer, optional): hard timeout, default 600000.",
        "- bail (boolean, optional): fast triage, stop at the first failing test, default false. Turning it on records only the first killing test, marks the kill rows attributionComplete false and makes D6 refuse a unique-kill verdict for this mutant.",
        "",
        "Returns: { ok: true, mutantId: number, outcome: 'killed' | 'survived' | 'timeout' | 'error' | 'unviable', killedBy: Array<{ file: string, name: string }>, command?: string, reason?: string, exitCode?: number | null, stderr?: string, expected?: string, found?: string | null, warnings?: string[] } or { ok: false, outcome: 'error', reason: string } when the mutant id is unknown. Every file in killedBy is repository relative.",
        "",
        "Examples:",
        "- Use it to prove one test bites, by showing the mutant it kills.",
        "- Use it with a narrow tests list, because a wide list attributes the kill to the wrong test.",
        "- Do NOT use it once per mutant over a generated set: that is one model turn per mutant and it rebuilds the environment every time. Call mutation_batch_run with every mutant id in one call.",
        "- Do NOT use it to run the suite normally: call runner_run_suite.",
        "- Do NOT use it to summarise which mutants lived: call mutation_survivors, or mutation_attribution for the per-test picture.",
        "",
        "Error handling: an unknown mutantId returns ok false and writes nothing. A mutant whose text cannot compile records 'unviable' with the reason, is never run and must never be retried, and it counts neither as a survivor nor as unrun. A worktree that cannot be created, a working tree that cannot be replayed, a node_modules link that cannot be made, or a source line that no longer matches the recorded text, all record outcome 'error' with the reason, and the line mismatch also returns expected and found. A run that exceeds the timeout records 'timeout', and the runner is killed with SIGTERM then SIGKILL. A report that cannot be read records 'error' with the reason, the exit code and the tail of stderr, and says so when the output was truncated first. Files that could not be carried into the worktree come back in warnings. The worktree and its patch file are removed on every path.",
      ].join("\n"),
      inputSchema: mutationApplyAndRunInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ cwd, mutantId, tests, command, timeoutMs, bail }) =>
      respondAsync(
        "Pass fewer entries in tests: the killing tests are listed one by one.",
        () =>
          mutationApplyAndRun({
            cwd,
            mutantId,
            tests,
            command,
            timeoutMs,
            bail,
          })
      )
  );

  server.registerTool(
    "mutation_batch_run",
    {
      title: "Run many mutants through the campaign lanes",
      description: [
        "Runs a whole list of mutants through the reusable lanes of a started campaign, one worker pool, one call. Each lane keeps its worktree between mutants and only puts the mutated line back, so no checkout, container, migration or seed is paid per mutant. Each lane also holds its own vite cache directory, because the lanes share one node_modules and would otherwise corrupt one transform cache between them.",
        "",
        "A run that failed on the environment rather than on the code, which is what a contested copy of the seed database looks like, is never counted as a kill: it is retried and, if it keeps failing, recorded as an error with the signature that gave it away.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- mutantIds (integer[]): persisted mutants to run.",
        "- tests (string[]): the test files to run, and nothing else.",
        "- campaignId (integer, optional): without it, the newest ready campaign.",
        "- concurrency (integer, optional): lanes to use, capped by the campaign. Default every lane.",
        "- command (string, optional): override the test command, default 'npx vitest run'.",
        "- timeoutMs (integer, optional): hard timeout per mutant, default 600000.",
        "- bail (boolean, optional): fast triage, stop each run at the first failing test, default false. Turning it on records only the first killing test of each mutant, marks those kill rows attributionComplete false and makes D6 refuse a unique-kill verdict for the run.",
        "- seedCopyRetries (integer, optional): retries for an environment failure, default 2.",
        "- staggerMs (integer, optional): delay between lane starts, default 750.",
        "- includeKills (boolean, optional): return the killing tests inline, default false.",
        "- refreshLanes (boolean, optional): replay the current working tree into every lane first, default false.",
        "- minimumFreeGb (number, optional): disk floor, default 4.",
        "- maximumContainers (integer, optional): container ceiling, default 40.",
        "- reuseProcess (boolean, optional): hold one vitest process open for a small group of mutants, default false.",
        "- reuseBatchSize (integer, optional): mutants per held process, default 5, ceiling 25.",
        "",
        "Process reuse: with reuseProcess false, every mutant pays node startup, vitest startup and the setup file imports again. With it true, the mutants are cut into groups of reuseBatchSize and each group runs against one held vitest process, which pays that startup once for the group. The group is the blast radius on purpose: a held process that dies takes at most reuseBatchSize mutants with it, and every one of them is then rerun in a fresh process of its own. A mutant whose held process died is never recorded from that process, so a crash can never be read as a survivor; the rerun is visible in the result as processRetries 1 and reusedProcess false, and the run reports how many processes were started, how many were lost and how many mutants had to be rerun. Reuse is off by default until a run with it on is shown to give the same outcome for every mutant as a run with it off.",
        "",
        "- page (object, optional): { offset, limit } opens a window of the per mutant results. Omit it and only the summary comes back.",
        "",
        "Returns: { ok: true, campaignId: number, lanes: number, counts: { killed, survived, timeout, error, aborted }, results: ListView, aborted: boolean, abortReason: string | null, headroom, reuse: { enabled, batchSize, processesStarted, processesLost, mutantsOnReusedProcess, mutantsRetriedFresh }, durationMs: number } or { ok: false, reason: string }. The ListView carries { total, groups by outcome, sample, handle, page?, items? } and its handle path is a JSON file holding every per mutant row.",
        "",
        "Examples:",
        "- Use it after mutation_campaign_start, with every mutant of one file in a single call.",
        "- Use it with the default bail false, because attribution is what the campaign is for; reach for bail true only to triage whether a set of mutants dies at all, and re-run without it before reading mutation_attribution.",
        "- Do NOT use it without a campaign: mutation_apply_and_run is the one mutant path and builds its own environment.",
        "- Do NOT use it to read what survived: call mutation_survivors.",
        "",
        "Truncation: the summary is bounded whatever the batch size, so a large batch no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: no campaign, a campaign that is not ready, a campaign with no lanes, and a list where no mutant id exists, all return ok false and run nothing. A working tree that changed since the campaign started also returns ok false, because the lanes would measure the mutants against stale tests; pass refreshLanes true to replay the change into every lane instead. The guard is read again before every mutant, and a breached disk floor or container ceiling stops the batch: the mutants already run keep their outcome, the rest come back 'aborted' with abortReason and no outcome is written for them. A lane whose mutated line cannot be put back is marked broken and stops the batch, because the next mutant on that lane would be measured against dirty source.",
      ].join("\n"),
      inputSchema: mutationBatchRunInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ page, ...input }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for every per mutant row.",
        async () => {
          const batch = await mutationBatchRun(input);
          if (!batch.ok) return batch;
          const { results, ...rest } = batch;
          return {
            ...rest,
            results: listView({
              kind: "mutation-batch",
              items: results,
              label: (result) =>
                `${result.outcome} mutant ${result.mutantId} on lane ${result.laneNo}`,
              group: (result) => result.outcome,
              page,
            }),
          };
        }
      )
  );

  server.registerTool(
    "mutation_survivors",
    {
      title: "List the mutants still alive",
      description: [
        "Returns the mutants that survived and hold no upheld and signed equivalence claim, plus the mutants that were never run, plus the mutants that could not compile, with the predicate D5 that holds when the survivor and unrun lists are both empty.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer): run whose mutants are counted.",
        "- page (object, optional): { list: 'survivors' | 'unrun' | 'unviable', offset, limit } opens a window of one list.",
        "",
        "Returns: { survivorCount: number, unrunCount: number, unviableCount: number, signedEquivalents: number, d5: boolean, survivors: ListView, unrun: ListView, unviable: ListView }. Each ListView carries { total, groups by operator, sample, handle, page?, items? } and its handle path is a JSON file holding every mutant row.",
        "",
        "Examples:",
        "- Use it to decide whether the mutation gate can pass.",
        "- Use the counts and the samples to pick the next survivor to kill or to claim as equivalent.",
        "- Do NOT use it to learn which test killed what: call mutation_attribution.",
        "- Do NOT use it to close a survivor: call mutation_equivalence_record, or write the test and re-run mutation_batch_run.",
        "",
        "Truncation: the summary is bounded whatever the run size, so the whole source line of every survivor no longer lands in the reply. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a run with no mutants returns empty lists and d5 true, so check that mutation_generate persisted mutants for that runId before trusting the pass. A mutant in unviable could not compile, so it can never be killed: leave it alone and do not run it again.",
      ].join("\n"),
      inputSchema: mutationSurvivorsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const alive = await mutationSurvivors({ cwd, runId });
          return {
            survivorCount: alive.survivorCount,
            unrunCount: alive.unrunCount,
            unviableCount: alive.unviableCount,
            signedEquivalents: alive.signedEquivalents,
            d5: alive.d5,
            survivors: listView({
              kind: "mutation-survivors",
              items: alive.survivors,
              label: (mutant) =>
                `${mutant.operator} ${mutant.file_path}:${mutant.line} (${mutant.outcome})`,
              group: (mutant) => mutant.operator,
              page: pageFor("survivors", page),
            }),
            unrun: listView({
              kind: "mutation-unrun",
              items: alive.unrun,
              label: (mutant) =>
                `${mutant.operator} ${mutant.file_path}:${mutant.line}`,
              group: (mutant) => mutant.operator,
              page: pageFor("unrun", page),
            }),
            unviable: listView({
              kind: "mutation-unviable",
              items: alive.unviable,
              label: (mutant) =>
                `${mutant.operator} ${mutant.file_path}:${mutant.line}`,
              group: (mutant) => mutant.operator,
              page: pageFor("unviable", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "mutation_equivalence_record",
    {
      title: "Record an equivalence claim",
      description: [
        "Records the claim that a surviving mutant cannot change any observable behaviour, together with any refutation of that claim and the human signature that upholds it. The mutant outcome follows the claim.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- mutantId (integer): the mutant the claim is about.",
        "- claimedBy (string): who claims equivalence.",
        "- argument (string): why no behaviour can change.",
        "- refutedBy (string, optional): who refuted the claim.",
        "- refutation (string, optional): the behaviour the claim missed.",
        "- upheld (boolean, optional): whether the claim stands.",
        "- signedBy (string, optional): the human signature.",
        "",
        "Returns: { claimId: number, mutantId: number, outcome: MutantOutcome, countsTowardD5: boolean, needsHumanSignature: boolean }.",
        "",
        "Examples:",
        "- Use it when a survivor cannot be killed because the mutated line has no observable effect.",
        "- Use it again with upheld and signedBy once a human has signed, which is what removes the mutant from the survivor list.",
        "- Do NOT use it to record that a mutant died: mutation_apply_and_run already records the kill.",
        "- Do NOT use it to check whether D5 now holds: call mutation_survivors.",
        "",
        "Error handling: a second call for the same mutant updates the existing claim rather than adding one, so a refutation replaces the earlier verdict. An upheld claim with no signedBy comes back with needsHumanSignature true and still counts toward D5.",
      ].join("\n"),
      inputSchema: mutationEquivalenceRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      cwd,
      mutantId,
      claimedBy,
      argument,
      refutedBy,
      refutation,
      upheld,
      signedBy,
    }) =>
      respondAsync("Record one mutantId per call.", () =>
        mutationEquivalenceRecord({
          cwd,
          mutantId,
          claimedBy,
          argument,
          refutedBy,
          refutation,
          upheld,
          signedBy,
        })
      )
  );

  server.registerTool(
    "mutation_attribution",
    {
      title: "Attribute kills to tests",
      description: [
        "Groups the recorded kills of a run by test and reports how many kills each test made and how many of them no other test made, with the predicate D6 that holds when every test has at least one unique kill.",
        "",
        "Unique-kill attribution needs every test that kills a mutant, so it can only be computed from kills recorded without bail. When any kill row of the run was written under bail the whole answer is refused rather than guessed: attributionComplete comes back false, indeterminate carries the reason, d6 is null, every uniqueKills and uniqueMutantIds is null, and withoutUniqueKills and withoutKills come back empty, because under bail a test that ran after the first killer looks identical to a test that kills nothing. Re-run the mutants without bail to get a verdict.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer): run whose kills are attributed.",
        "- tests (string[], optional): roster of every test in scope, as file::title, so the ones that killed nothing can be named.",
        "- page (object, optional): { list: 'attribution' | 'withoutUniqueKills' | 'withoutKills', offset, limit } opens a window of one list.",
        "",
        "Returns: { d6: boolean | null, attributionComplete: boolean, indeterminate: string | null, attribution: ListView, withoutUniqueKills: ListView, withoutKills: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row. An attribution row is { testFile, testName, mutantIds, uniqueMutantIds: number[] | null, kills: number, uniqueKills: number | null }.",
        "",
        "Examples:",
        "- Use it to find the test that earns nothing, so it can be pruned; withoutKills.total answers that on its own.",
        "- Use it with the tests roster, because a test that killed nothing appears nowhere in the kill records.",
        "- Do NOT use it to learn which mutants are still alive: call mutation_survivors.",
        "- Do NOT use it before the mutants have been run: with no kills recorded every test lands in withoutKills.",
        "- Do NOT prune a test on an indeterminate answer: d6 null means the attribution was never computed, not that the tests earn nothing.",
        "",
        "Truncation: the summary is bounded whatever the kill count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a run with no recorded kills is not an error; it returns an empty attribution, every declared test in withoutKills and d6 false when a roster was supplied. A run whose kills were recorded under bail returns d6 null with indeterminate set, and no count in it may be read as a unique-kill verdict.",
      ].join("\n"),
      inputSchema: mutationAttributionInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId, tests, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const attributed = await mutationAttribution({ cwd, runId, tests });
          return {
            d6: attributed.d6,
            attributionComplete: attributed.attributionComplete,
            indeterminate: attributed.indeterminate,
            attribution: listView({
              kind: "mutation-attribution",
              items: attributed.attribution,
              label: (row) =>
                `${row.testFile}::${row.testName} killed ${row.kills}, unique ${
                  row.uniqueKills ?? "indeterminate"
                }`,
              group: (row) =>
                row.uniqueKills === null
                  ? "indeterminate"
                  : row.uniqueKills > 0
                  ? "earning"
                  : "no-unique",
              page: pageFor("attribution", page),
            }),
            withoutUniqueKills: listView({
              kind: "mutation-without-unique-kills",
              items: attributed.withoutUniqueKills,
              label: (ref) => ref,
              page: pageFor("withoutUniqueKills", page),
            }),
            withoutKills: listView({
              kind: "mutation-without-kills",
              items: attributed.withoutKills,
              label: (ref) => ref,
              page: pageFor("withoutKills", page),
            }),
          };
        }
      )
  );
};
