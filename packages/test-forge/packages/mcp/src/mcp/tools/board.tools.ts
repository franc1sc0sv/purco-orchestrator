import { boardAttention } from "../../application/board/attention.ts";
import { boardCompute } from "../../application/board/compute.ts";
import { boardOutcomeRecordBatch } from "../../application/board/outcome-record-batch.ts";
import { boardOutcomeRecord } from "../../application/board/outcome-record.ts";
import { boardReplayRecord } from "../../application/board/replay-record.ts";
import { boardWargameList } from "../../application/board/wargame-list.ts";
import { boardWargameRecord } from "../../application/board/wargame-record.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor, pageInput } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  REPLAY_RESULTS,
  SCORED_EVENT_KINDS,
  WAR_GAME_STATUSES,
} from "test-forge-contracts/board";
import { z } from "zod";

const cwd = z.string().describe("Absolute path of the repository root.");

const runId = z
  .number()
  .int()
  .describe("Run the outcomes belong to.")
  .optional();

const outcomeItem = z
  .object({
    callsign: z.string().describe("The agent the outcome is scored against."),
    post: z.string().describe("The post the agent held, for example tester."),
    aspect: z
      .string()
      .describe("The aspect the outcome is about, for example isolation.")
      .optional(),
    eventKind: z
      .string()
      .describe(
        `What happened. A kind outside this list is stored but does not score: ${SCORED_EVENT_KINDS.join(
          ", "
        )}.`
      ),
    weight: z
      .number()
      .describe("How heavily the outcome counts. Default 1.")
      .optional(),
  })
  .strict();

const outcomeRecordInput = z
  .object({ cwd, runId, ...outcomeItem.shape })
  .strict();

const outcomeRecordBatchInput = z
  .object({
    cwd,
    runId,
    outcomes: z
      .array(outcomeItem)
      .min(1)
      .describe(
        "Every outcome you are recording, in one call. A whole exam or a whole verification pass belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const computeInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    window: z
      .number()
      .int()
      .describe("How many recent outcomes per post are scored.")
      .optional(),
  })
  .strict();

const attentionInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
  })
  .strict();

const wargameRecordInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    scenarioKey: z
      .string()
      .describe("Stable key of the scenario. Recording it twice updates it."),
    squad: z.string().describe("The squad the scenario belongs to."),
    post: z.string().describe("The post that failed."),
    aspect: z.string().describe("The aspect that failed.").optional(),
    engagement: z
      .union([z.record(z.unknown()), z.string()])
      .describe("The inputs the agent was given, as an object or raw JSON.")
      .optional(),
    whatHappened: z.string().describe("What the agent actually did."),
    whatWasCorrect: z.string().describe("What the agent should have done."),
    rootCause: z.string().describe("Why it went wrong."),
    status: z
      .enum(WAR_GAME_STATUSES)
      .describe("Scenario state. Default 'open'.")
      .optional(),
  })
  .strict();

const wargameListInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    status: z.enum(WAR_GAME_STATUSES).describe("Keep one state.").optional(),
    aspect: z.string().describe("Keep one aspect.").optional(),
    post: z.string().describe("Keep one post.").optional(),
    page: pageInput.optional(),
  })
  .strict();

const replayRecordInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    scenarioKey: z
      .string()
      .describe("Scenario key. Supply this or scenarioId.")
      .optional(),
    scenarioId: z
      .number()
      .int()
      .describe("Scenario id. Takes precedence over scenarioKey.")
      .optional(),
    result: z
      .enum(REPLAY_RESULTS)
      .describe("What the replay did with the scenario."),
    note: z.string().describe("What the replay showed.").optional(),
  })
  .strict();

export const registerBoardTools = (server: McpServer): void => {
  server.registerTool(
    "board_outcome_record",
    {
      title: "Record one outcome against a post",
      description: [
        "Appends one outcome for a callsign at a post in an aspect. Known event kinds carry a polarity and score; an unknown kind is still stored, so nothing is lost, but it does not move the board.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer, optional): the run the outcome belongs to.",
        "- callsign (string): the agent scored.",
        "- post (string): the post the agent held.",
        "- aspect (string, optional): the aspect the outcome is about.",
        "- eventKind (string): what happened, for example mutant-killed or false-positive.",
        "- weight (number, optional): how heavily it counts, default 1.",
        "",
        "Returns: { outcomeId: number, scored: boolean, polarity: 'positive' | 'negative' | 'unscored', knownEventKinds?: string[] }. The kind list comes back only when the event kind was not recognised.",
        "",
        "Examples:",
        "- Use it for the one late outcome you scored after the batch already went out.",
        "- Use it right after a single verdict is upheld or overturned, so the board reflects the run.",
        "- Do NOT use it once per fixture or once per verdict of a pass: that is one model turn per outcome. Call board_outcome_record_batch with every outcome in one call.",
        "- Do NOT use it to read a score: call board_compute.",
        "- Do NOT use it to record an agent failure worth replaying: call board_wargame_record.",
        "",
        "Error handling: an unrecognised eventKind is not rejected. It is stored with scored false and the response lists the kinds that do score, so the caller can correct the next call.",
      ].join("\n"),
      inputSchema: outcomeRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, callsign, post, aspect, eventKind, weight }) =>
      respondAsync("Record one outcome per call.", () =>
        boardOutcomeRecord({
          cwd,
          runId: id,
          callsign,
          post,
          aspect,
          eventKind,
          weight,
        })
      )
  );

  server.registerTool(
    "board_outcome_record_batch",
    {
      title: "Record every outcome of a pass in one call",
      description: [
        "Appends many outcomes in one call and answers with a summary instead of one row per outcome. Each entry is written exactly as board_outcome_record writes it, an entry that fails is reported without stopping the rest, and the unknown event kinds are counted so a whole exam scored against the wrong kind is visible at once.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer, optional): the run the outcomes belong to.",
        "- outcomes (array): every { callsign, post, eventKind, aspect?, weight? } you are recording.",
        "- page (object, optional): { list: 'outcomes' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, recordedCount, failedCount, unscoredCount, outcomes: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every row.",
        "",
        "Examples:",
        "- Use it to land a whole exam, one entry per fixture, after every fixture is marked.",
        "- Use it to score a whole verification pass, one entry per reviewer verdict.",
        "- Do NOT loop board_outcome_record over the fixtures or the verdicts; one call per outcome costs a model turn per outcome.",
        "- Do NOT use it to read a score: call board_compute.",
        "- Do NOT use it to record an agent failure worth replaying: call board_wargame_record.",
        "",
        "Truncation: the summary is bounded whatever the outcome count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unrecognised eventKind is not rejected. It is stored with scored false and counts in unscoredCount, so a whole exam scored against a kind that does not move the board is named in one number. An entry that cannot be stored lands in failures with its callsign, post and event kind, while the other entries still record.",
      ].join("\n"),
      inputSchema: outcomeRecordBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, runId: id, outcomes, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await boardOutcomeRecordBatch({
            cwd,
            runId: id,
            outcomes,
          });
          return {
            requested: batch.requested,
            recordedCount: batch.recordedCount,
            failedCount: batch.failedCount,
            unscoredCount: batch.unscoredCount,
            outcomes: listView({
              kind: "board-outcomes",
              items: batch.outcomes,
              label: (row) =>
                `${row.eventKind} ${row.callsign}/${row.post} (${row.polarity})`,
              group: (row) => row.eventKind,
              page: pageFor("outcomes", page),
            }),
            failures: listView({
              kind: "board-outcome-failures",
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
    "board_compute",
    {
      title: "Score every post on the board",
      description: [
        "Scores every callsign, post and aspect over a rolling window of recent outcomes, with the trend, the rung on the seven-rung ladder and the state, then persists the ranks. Demotion happens on every computation, so a rank is never held by history alone.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- window (integer, optional): how many recent outcomes per post are scored.",
        "",
        "Returns: { board: Array<{ callsign, post, aspect, score, state, rank, trend, outcomes, windowSize, unscoredEvents }>, counts: { posts: number, byState: Record<BoardState, number> }, windowSize: number }.",
        "",
        "Examples:",
        "- Use it to show the whole board, or to check a rank after recording outcomes.",
        "- Use it with a smaller window to see how the board reacts to recent work only.",
        "- Do NOT use it to decide what to do next: call board_attention, which names the one thing.",
        "- Do NOT use it to add an outcome: call board_outcome_record.",
        "",
        "Truncation: a board with many callsigns and aspects can exceed the 25000 character limit. Narrow the result by lowering window, which drops the posts with no recent outcomes.",
        "",
        "Error handling: a project with no outcomes returns an empty board and posts 0 rather than failing. Every call rewrites the persisted ranks, so it is safe to repeat.",
      ].join("\n"),
      inputSchema: computeInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, window }) =>
      respondAsync(
        "Lower window so only posts with recent outcomes are scored.",
        () => boardCompute({ cwd, window })
      )
  );

  server.registerTool(
    "board_attention",
    {
      title: "Name the one thing worth attention",
      description: [
        "Recomputes the board, finds the lowest-scoring post, counts the War Games still open against it, and returns one sentence naming the single next command to run, with the row it was derived from.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "",
        "Returns: { sentence: string, basis: { reason: string } | RankRow | (RankRow & { openWarGames: number }) }.",
        "",
        "Examples:",
        "- Use it to open a status report, so the reader gets one instruction rather than a table.",
        "- Use it after a run to see whether the weakest post moved.",
        "- Do NOT use it when the whole board is wanted: call board_compute.",
        "- Do NOT use it to list the open scenarios behind the sentence: call board_wargame_list.",
        "",
        "Error handling: a project with no scored outcomes is not an error; the sentence says to seed the doctrine and the basis carries the reason instead of a row. This tool recomputes and persists the ranks as a side effect, exactly as board_compute does.",
      ].join("\n"),
      inputSchema: attentionInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd }) =>
      respondAsync("This result is already one sentence and one row.", () =>
        boardAttention({ cwd })
      )
  );

  server.registerTool(
    "board_wargame_record",
    {
      title: "Record a War Games scenario",
      description: [
        "Records a past agent failure worth replaying: the engagement it was given, what it did, what was correct, and the root cause. Recording the same scenarioKey again updates the scenario in place.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- scenarioKey (string): stable key of the scenario.",
        "- squad (string): the squad it belongs to.",
        "- post (string): the post that failed.",
        "- aspect (string, optional): the aspect that failed.",
        "- engagement (object or string, optional): the inputs the agent was given.",
        "- whatHappened (string): what the agent did.",
        "- whatWasCorrect (string): what it should have done.",
        "- rootCause (string): why it went wrong.",
        "- status ('open' | 'drilled' | 'passing' | 'retired', optional): default 'open'.",
        "",
        "Returns: { scenarioId: number, scenarioKey: string, status: WarGameStatus }.",
        "",
        "Examples:",
        "- Use it the moment a review catches an agent doing the wrong thing, so the failure can be replayed later.",
        "- Use it with the same scenarioKey to correct a scenario you already recorded.",
        "- Do NOT use it to record the result of replaying one: call board_replay_record.",
        "- Do NOT use it to score the agent: call board_outcome_record.",
        "",
        "Error handling: an engagement given as a string is stored as it stands; anything else is serialised to JSON. Omitting status on an update sets the scenario back to 'open', so pass the status you want to keep.",
      ].join("\n"),
      inputSchema: wargameRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      cwd,
      scenarioKey,
      squad,
      post,
      aspect,
      engagement,
      whatHappened,
      whatWasCorrect,
      rootCause,
      status,
    }) =>
      respondAsync("Record one scenarioKey per call.", () =>
        boardWargameRecord({
          cwd,
          scenarioKey,
          squad,
          post,
          aspect,
          engagement,
          whatHappened,
          whatWasCorrect,
          rootCause,
          status,
        })
      )
  );

  server.registerTool(
    "board_wargame_list",
    {
      title: "List War Games scenarios",
      description: [
        "Lists the War Games scenarios of the project, newest first, each with its most recent replay result.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- status ('open' | 'drilled' | 'passing' | 'retired', optional): keep one state.",
        "- aspect (string, optional): keep one aspect.",
        "- post (string, optional): keep one post.",
        "- page (object, optional): { offset, limit } opens a window of the scenarios. Omit it and only the summary comes back.",
        "",
        "Returns: { count: number, scenarios: ListView }. The ListView carries { total, groups by status, sample, handle, page?, items? } and its handle path is a JSON file holding every scenario with its whole narrative.",
        "",
        "Examples:",
        "- Use it before a replay session, to collect the scenarios still open.",
        "- Use it with status 'passing' to show what a change must not break.",
        "- Do NOT use it to add a scenario: call board_wargame_record.",
        "- Do NOT use it to record a replay: call board_replay_record.",
        "",
        "Truncation: the summary is bounded whatever the history size, so the whole narrative of every scenario no longer lands in the reply. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: filters that match nothing return an empty list with count 0 rather than failing.",
      ].join("\n"),
      inputSchema: wargameListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, status, aspect, post, page }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for every scenario.",
        async () => {
          const listed = await boardWargameList({ cwd, status, aspect, post });
          return {
            count: listed.count,
            scenarios: listView({
              kind: "wargame-scenarios",
              items: listed.scenarios,
              label: (scenario) =>
                `${scenario.status} ${scenario.scenarioKey} (${scenario.aspect})`,
              group: (scenario) => scenario.status,
              page,
            }),
          };
        }
      )
  );

  server.registerTool(
    "board_replay_record",
    {
      title: "Record the result of one replay",
      description: [
        "Records what happened when a War Games scenario was replayed against the current briefs and rules. A catch marks the scenario passing, a miss reopens it, and an error or a skip leaves the state as it was.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- scenarioKey (string, optional): the scenario key.",
        "- scenarioId (integer, optional): the scenario id, which takes precedence.",
        "- result ('caught' | 'missed' | 'error' | 'skipped'): what the replay did.",
        "- note (string, optional): what the replay showed.",
        "",
        "Returns: { recorded: true, replayId: number, scenarioId: number, result: ReplayResult, status: WarGameStatus } or { recorded: false, reason: string } when no such scenario exists.",
        "",
        "Examples:",
        "- Use it after every replay, so a restored rank rests on evidence.",
        "- Use it with result 'missed' when the agent repeated the old failure, which reopens the scenario.",
        "- Do NOT use it to create the scenario: call board_wargame_record first.",
        "- Do NOT use it to read the replay history: call board_wargame_list, which returns the most recent replay per scenario.",
        "",
        "Error handling: a scenarioKey and scenarioId that match nothing return recorded false with the reason, and no replay is stored. Supplying neither is treated the same way.",
      ].join("\n"),
      inputSchema: replayRecordInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, scenarioKey, scenarioId, result, note }) =>
      respondAsync("Record one replay per call.", () =>
        boardReplayRecord({ cwd, scenarioKey, scenarioId, result, note })
      )
  );
};
