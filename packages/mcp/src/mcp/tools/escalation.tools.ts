import { assignmentRecord } from "../../application/escalation/assignment-record.ts";
import { escalationOpen } from "../../application/escalation/open.ts";
import { escalationRaise } from "../../application/escalation/raise.ts";
import { escalationResolve } from "../../application/escalation/resolve.ts";
import { listView } from "../../application/listing/list-view.ts";
import { asEvidence } from "../../domain/escalation/escalation.ts";
import { pageInput } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ESCALATION_RESOLUTIONS,
  ESCALATION_SUBJECT_KINDS,
} from "test-forge-contracts/escalation";
import type { PostOverride } from "test-forge-contracts/escalation";
import type { Outcome } from "test-forge-contracts/outcome";
import { z } from "zod";

const cwd = z
  .string()
  .describe("Absolute path inside the project the run belongs to.");

const runId = z
  .number()
  .int()
  .describe("Run identifier from ledger_run_start.");

const subjectKind = z
  .enum(ESCALATION_SUBJECT_KINDS)
  .describe(
    "What the escalation is about: rule, file, test, finding, mutant, matrix-cell, radius-node, focus-item, assignment or instruction."
  );

const citation = z
  .object({
    location: z
      .string()
      .describe(
        "Where it was observed, for example file.ts:42 or a tool name."
      ),
    observed: z
      .string()
      .describe("What was observed there, quoted or stated exactly."),
  })
  .strict();

const evidenceList = z
  .array(citation)
  .min(1)
  .describe(
    "At least one citation. A non-delivered outcome without evidence is refused."
  );

const deliveredOutcome = z
  .object({
    kind: z.literal("delivered").describe("The work was done as instructed."),
    summary: z.string().describe("What was delivered, in one line."),
    produced: z
      .array(z.string())
      .describe("What now exists: files written, rows recorded, tests added."),
  })
  .strict();

const blockedOutcome = z
  .object({
    kind: z
      .literal("blocked")
      .describe("The work cannot proceed until an escalation is resolved."),
    summary: z.string().describe("What stopped the work, in one line."),
    escalationKey: z
      .string()
      .describe(
        "Key of the escalation raised for this block. It must already exist on the run."
      ),
    evidence: evidenceList,
  })
  .strict();

const outOfScopeOutcome = z
  .object({
    kind: z
      .literal("out-of-scope")
      .describe("The instruction belongs to another post."),
    summary: z.string().describe("Why it falls outside this post."),
    belongsTo: z.string().describe("The post that owns the work instead."),
    evidence: evidenceList,
  })
  .strict();

const disputedOutcome = z
  .object({
    kind: z
      .literal("disputed")
      .describe("The instruction is contradicted by what the agent read."),
    summary: z.string().describe("The disagreement, in one line."),
    escalationKey: z
      .string()
      .describe(
        "Key of the escalation carrying the dispute. It must already exist on the run."
      ),
    disputedInstruction: z
      .string()
      .describe("The part of the instruction that is being disputed."),
    evidence: evidenceList,
  })
  .strict();

const failedOutcome = z
  .object({
    kind: z
      .literal("failed")
      .describe("The work was attempted and did not succeed."),
    summary: z.string().describe("What failed, in one line."),
    attempted: z.array(z.string()).describe("What was tried, in order."),
    evidence: evidenceList,
  })
  .strict();

const outcomeInput = z
  .discriminatedUnion("kind", [
    deliveredOutcome,
    blockedOutcome,
    outOfScopeOutcome,
    disputedOutcome,
    failedOutcome,
  ])
  .describe(
    "What came back from the assignment. Every non-delivered kind carries evidence."
  );

type OutcomeInput = z.infer<typeof outcomeInput>;

const overrideInput = z
  .object({
    overriddenBy: z
      .string()
      .describe("Who decided to depart from suggestedPost."),
    reason: z
      .string()
      .describe("Why that post is wrong for this item, in one line."),
  })
  .strict();

const raiseInput = z
  .object({
    cwd,
    runId,
    escalationKey: z
      .string()
      .describe(
        "Stable key for this escalation inside the run, for example rule-lies:ISO-004. Raising the same key twice returns the stored escalation and creates nothing."
      ),
    raisedBy: z.string().describe("Callsign of the agent raising it."),
    post: z.string().describe("Post that agent was working."),
    subjectKind,
    subjectRef: z
      .string()
      .describe(
        "What the claim is about: a rule id, a file path, a mutant id."
      ),
    claim: z
      .string()
      .describe(
        "What is wrong, stated as a claim that can be judged true or false."
      ),
    evidence: z
      .string()
      .describe(
        "What was read that supports the claim, with the location that proves it."
      ),
  })
  .strict();

const resolveInput = z
  .object({
    cwd,
    runId,
    escalationKey: z.string().describe("Key of the escalation to close."),
    resolution: z
      .enum(ESCALATION_RESOLUTIONS)
      .describe(
        "fixed: the thing was corrected. rule-changed: the rule was rewritten or retired. waived: it stands unfixed on purpose. rejected: the claim was judged wrong."
      ),
    resolvedBy: z
      .string()
      .describe("Who decided. A resolution with no named author is refused."),
    reason: z
      .string()
      .describe(
        "Why it is closed this way. A resolution with no written reason is refused, by the schema and again by the database."
      ),
  })
  .strict();

const openInput = z.object({ cwd, runId, page: pageInput.optional() }).strict();

const assignmentInput = z
  .object({
    cwd,
    runId,
    assignmentKey: z
      .string()
      .describe(
        "Stable key for this assignment inside the run. Recording the same key again updates it, which is how an outcome is attached later."
      ),
    suggestedPost: z
      .string()
      .describe(
        "The post the work list named. It is binding: assigning another post needs an override."
      ),
    assignedPost: z
      .string()
      .describe("The post actually assigned. Defaults to suggestedPost.")
      .optional(),
    assignedTo: z.string().describe("Callsign given the work."),
    subjectKind,
    subjectRef: z.string().describe("The item being worked."),
    instruction: z.string().describe("What that agent was told to do."),
    override: overrideInput
      .describe(
        "Required whenever assignedPost differs from suggestedPost, so the departure leaves a trail."
      )
      .optional(),
    outcome: outcomeInput
      .describe("Omit while the work is still out. Pass it when it comes back.")
      .optional(),
  })
  .strict();

const toOutcome = (input: OutcomeInput): Outcome => {
  if (input.kind === "delivered") {
    return {
      kind: "delivered",
      summary: input.summary,
      produced: input.produced,
    };
  }
  if (input.kind === "blocked") {
    return {
      kind: "blocked",
      summary: input.summary,
      escalationKey: input.escalationKey,
      evidence: asEvidence(input.evidence),
    };
  }
  if (input.kind === "out-of-scope") {
    return {
      kind: "out-of-scope",
      summary: input.summary,
      belongsTo: input.belongsTo,
      evidence: asEvidence(input.evidence),
    };
  }
  if (input.kind === "disputed") {
    return {
      kind: "disputed",
      summary: input.summary,
      escalationKey: input.escalationKey,
      disputedInstruction: input.disputedInstruction,
      evidence: asEvidence(input.evidence),
    };
  }
  return {
    kind: "failed",
    summary: input.summary,
    attempted: input.attempted,
    evidence: asEvidence(input.evidence),
  };
};

const toOverride = (input: z.infer<typeof overrideInput>): PostOverride => ({
  overriddenBy: input.overriddenBy,
  reason: input.reason,
});

export const registerEscalationTools = (server: McpServer): void => {
  server.registerTool(
    "escalation_raise",
    {
      title: "Raise an escalation that blocks the run",
      description: [
        "Records a claim that something the operation depends on is wrong, and holds it open until somebody named resolves it. While one escalation is open the tenth predicate D10 ESCALATION is false and gate 8 fails, so the run cannot report DONE. This exists because an agent that finds a real problem, reports it in prose and gets no answer leaves no trace: silence stops being a legal state once the claim is a row.",
        "",
        "Raise one when a rule's mechanical check disagrees with the file, when an instruction contradicts what was read, when a fixture and a rule cannot both be right, or when the work cannot proceed without a decision that is not yours.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run identifier from ledger_run_start.",
        "- escalationKey (string): stable key inside the run. Raising the same key twice creates nothing and returns what is stored.",
        "- raisedBy (string): callsign of the agent raising it.",
        "- post (string): the post that agent was working.",
        "- subjectKind (enum): rule | file | test | finding | mutant | matrix-cell | radius-node | focus-item | assignment | instruction.",
        "- subjectRef (string): what the claim is about.",
        "- claim (string): what is wrong, stated so it can be judged true or false.",
        "- evidence (string): what was read that supports it, with the location that proves it.",
        "",
        "Returns: { projectKey, runId, escalationId: number, escalationKey, raisedBy, subjectKind, subjectRef, claim, state: 'open' | 'resolved', created: boolean, openCount: number, d10: boolean, createdAt }.",
        "",
        "Examples:",
        "- Use it the moment a rule's check and your reading of the file disagree, naming both in evidence.",
        "- Use it before returning a blocked or disputed outcome to assignment_record, which refuses an escalationKey that was never raised.",
        "- Do NOT use it to record a defect in the code under test: that is ledger_finding_upsert.",
        "- Do NOT use it to waive an item: that is ledger_waiver_record, or escalation_resolve with resolution 'waived'.",
        "",
        "Truncation: the result is one escalation and cannot exceed the 25000 character limit.",
        "",
        "Error handling: an unknown runId fails the call. An empty claim, evidence, raisedBy or escalationKey fails the call, in the schema and again at the database. Raising a key that already exists is not an error; created comes back false and nothing is overwritten.",
      ].join("\n"),
      inputSchema: raiseInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      cwd: root,
      runId: id,
      escalationKey,
      raisedBy,
      post,
      subjectKind: kind,
      subjectRef,
      claim,
      evidence,
    }) =>
      respondAsync(
        "Raise one escalation per call; this result covers a single claim.",
        () =>
          escalationRaise({
            cwd: root,
            runId: id,
            escalationKey,
            raisedBy,
            post,
            subjectKind: kind,
            subjectRef,
            claim,
            evidence,
          })
      )
  );

  server.registerTool(
    "escalation_resolve",
    {
      title: "Close an open escalation, with an author and a reason",
      description: [
        "Closes one open escalation as fixed, rule-changed, waived or rejected. The waiver is the pressure valve of this contract: waiving is allowed, waiving silently is not. A resolution carries who decided and why, and neither can be empty - the database itself refuses a resolved escalation whose reason or author is missing, so a silent close is not representable rather than merely discouraged.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run that owns the escalation.",
        "- escalationKey (string): key of the escalation to close.",
        "- resolution (enum): 'fixed' the thing was corrected, 'rule-changed' the rule was rewritten or retired, 'waived' it stands unfixed on purpose, 'rejected' the claim was judged wrong.",
        "- resolvedBy (string): who decided.",
        "- reason (string): why it is closed this way.",
        "",
        "Returns: { projectKey, runId, escalationId, escalationKey, closure: { resolution, resolvedBy, reason, resolvedAt }, openCount: number, d10: boolean }.",
        "",
        "Examples:",
        "- Use it with 'rule-changed' after codex_rule_write corrects a rule whose check was lying, citing the new version in the reason.",
        "- Use it with 'rejected' when the claim was checked and found wrong, naming what proved it wrong.",
        "- Do NOT use it to close an escalation you cannot name a decider for: an unattributed close is refused.",
        "- Do NOT use it to check what is still open: call escalation_open.",
        "",
        "Truncation: the result is one escalation and cannot exceed the 25000 character limit.",
        "",
        "Error handling: an unknown escalationKey fails the call. An escalation already resolved fails the call, naming who closed it and how, so a second close cannot quietly rewrite the first. An empty reason or resolvedBy fails the call.",
      ].join("\n"),
      inputSchema: resolveInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd: root, runId: id, escalationKey, resolution, resolvedBy, reason }) =>
      respondAsync(
        "Resolve one escalationKey per call; this result covers a single escalation.",
        () =>
          escalationResolve({
            cwd: root,
            runId: id,
            escalationKey,
            resolution,
            resolvedBy,
            reason,
          })
      )
  );

  server.registerTool(
    "escalation_open",
    {
      title: "List the escalations still open",
      description: [
        "Reads the escalations of a run and returns the ones nobody has resolved, oldest first, with the tenth predicate D10 that holds when the list is empty. This is the answer to the question that had no data structure before: what was raised and never resolved.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run whose escalations are counted.",
        "- page (object, optional): { offset, limit } opens a window of the open list. Omit it and only the summary comes back.",
        "",
        "Returns: { projectKey, runId, openCount: number, totalEscalations: number, d10: boolean, open: ListView }. The ListView carries { total, groups by subject kind, sample, handle, page?, items? } and its handle path is a JSON file holding every open escalation.",
        "",
        "Examples:",
        "- Use it before reporting DONE, because gate 8 fails while anything is open.",
        "- Use openCount and the sample to pick the next claim to hand to escalation_resolve.",
        "- Do NOT use it to raise a claim: call escalation_raise.",
        "- Do NOT use it to read the whole run: call ledger_state.",
        "",
        "Truncation: the summary is bounded whatever the escalation count. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a run with no escalations is not an error; it returns an empty list, totalEscalations 0 and d10 true, which is the correct reading - nothing was raised.",
      ].join("\n"),
      inputSchema: openInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd: root, runId: id, page }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for the whole open list.",
        async () => {
          const escalations = await escalationOpen({ cwd: root, runId: id });
          return {
            ...escalations,
            open: listView({
              kind: "escalations-open",
              items: escalations.open,
              label: (entry) =>
                `${entry.escalationKey} (${entry.raisedBy}): ${entry.claim}`,
              group: (entry) => entry.subjectKind,
              page,
            }),
          };
        }
      )
  );

  server.registerTool(
    "assignment_record",
    {
      title: "Record one assignment and what came back from it",
      description: [
        "Records who was given which item, under which post, and later what came back. The post the work list suggested is binding: assigning a different one needs an override naming who departed from it and why, and the database refuses the row otherwise, so an override is always reproducible from the ledger rather than from memory.",
        "",
        "The outcome envelope has five kinds and only 'delivered' may be bare. 'blocked' and 'disputed' must name an escalation that was already raised; 'out-of-scope' must name the post that owns the work instead; 'failed' must list what was attempted. Every kind except 'delivered' carries at least one evidence citation, so the envelope cannot become a shrug an agent uses to avoid work.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project the run belongs to.",
        "- runId (integer): run identifier from ledger_run_start.",
        "- assignmentKey (string): stable key inside the run. Recording it again updates the row, which is how the outcome is attached later.",
        "- suggestedPost (string): the post the work list named.",
        "- assignedPost (string, optional): the post actually assigned. Defaults to suggestedPost.",
        "- assignedTo (string): callsign given the work.",
        "- subjectKind (enum): rule | file | test | finding | mutant | matrix-cell | radius-node | focus-item | assignment | instruction.",
        "- subjectRef (string): the item being worked.",
        "- instruction (string): what that agent was told to do.",
        "- override (object, optional): { overriddenBy, reason }. Required when assignedPost differs from suggestedPost.",
        "- outcome (object, optional): one of { kind: 'delivered', summary, produced }, { kind: 'blocked', summary, escalationKey, evidence }, { kind: 'out-of-scope', summary, belongsTo, evidence }, { kind: 'disputed', summary, escalationKey, disputedInstruction, evidence }, { kind: 'failed', summary, attempted, evidence }.",
        "",
        "Returns: { projectKey, runId, assignmentId, assignmentKey, suggestedPost, assignedPost, postOverridden: boolean, outcomeKind: string | null, escalationId: number | null, completedAt: string | null }.",
        "",
        "Examples:",
        "- Use it when handing out the work list, without an outcome, so the assignment exists before the work does.",
        "- Use it again with the same assignmentKey and an outcome when the agent reports back.",
        "- Do NOT use it to record a blocked outcome before escalation_raise: the escalationKey is checked and the call fails.",
        "- Do NOT use it to record a done vector or a pass: that is gates_evaluate.",
        "",
        "Truncation: the result is one assignment and cannot exceed the 25000 character limit.",
        "",
        "Error handling: an unknown runId fails the call. An assignedPost differing from suggestedPost without an override fails the call, naming both posts. A blocked or disputed outcome whose escalationKey was never raised on the run fails the call and nothing is written.",
      ].join("\n"),
      inputSchema: assignmentInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({
      cwd: root,
      runId: id,
      assignmentKey,
      suggestedPost,
      assignedPost,
      assignedTo,
      subjectKind: kind,
      subjectRef,
      instruction,
      override,
      outcome,
    }) =>
      respondAsync(
        "Record one assignmentKey per call; this result covers a single assignment.",
        () =>
          assignmentRecord({
            cwd: root,
            runId: id,
            assignmentKey,
            suggestedPost,
            assignedTo,
            subjectKind: kind,
            subjectRef,
            instruction,
            ...(assignedPost === undefined ? {} : { assignedPost }),
            ...(override === undefined
              ? {}
              : { override: toOverride(override) }),
            ...(outcome === undefined ? {} : { outcome: toOutcome(outcome) }),
          })
      )
  );
};
