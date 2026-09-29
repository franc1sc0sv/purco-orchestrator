import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { clusterGate } from "./gates.ts";
import type { Store } from "./store.ts";
import type { Scratchpad } from "./scratchpad.ts";
import type { Phase, SiteAxis, SiteState } from "./types.ts";

export const SPIKE_SERVER_NAME = "spike";

export const SPIKE_TOOL_NAMES = [
  "worklist",
  "finding",
  "triage",
  "verdict",
  "findings",
  "finish",
].map((name) => `mcp__${SPIKE_SERVER_NAME}__${name}`);

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

export type SpikeToolContext = {
  store: Store;
  scratchpad: Scratchpad;
  currentPhase: () => Phase | "run";
  activeAgent: () => string;
  activeCluster: () => string;
  recordHandoff: (agent: string, summary: string, outputPath?: string) => void;
};

const AXES = ["A", "B", "C", "D", "E"] as const;
const STATES = ["no_change", "leftover", "defect", "keeps_account"] as const;
const OPERATIONS = ["read", "create", "edit", "delete"] as const;
const SEVERITIES = ["data_loss", "wrong_display", "cosmetic"] as const;
const VERDICTS = ["verified", "rejected", "needs_human"] as const;

const describeSite = (site: {
  path: string;
  axis: string;
  touchesBa: boolean | number;
  touchesIp: boolean | number;
  hasFlag: boolean | number;
  isWriter: boolean | number;
  hits?: number;
  reachedVia?: string;
}): string => {
  const marks = [
    site.isWriter ? "WRITER" : "read",
    site.touchesBa ? "account" : "-",
    site.touchesIp ? "party" : "-",
    site.hasFlag ? "flagged" : "unflagged",
  ].join(" ");
  const hits = site.hits ?? 1;
  const via = site.reachedVia ? `  reached ${site.reachedVia}` : "";
  return `${site.axis}  ${marks}  ${hits} occurrence(s)  ${site.path}${via}`;
};

export const buildSpikeServer = (ctx: SpikeToolContext) =>
  createSdkMcpServer({
    name: SPIKE_SERVER_NAME,
    version: "0.1.0",
    instructions: [
      "You are auditing one cluster of a feature-flag removal spike. The census already found every site. Your job is to judge them, not to find them.",
      "Call `worklist` first. It returns your cluster's sites and nothing else. Do not search the repository for more work.",
      "For every site in the worklist: read the file, decide, then call `triage` exactly once for that site.",
      "Call `finding` only when a site carries a real leftover or defect. A site that needs no change gets `triage` alone.",
      "Call `finish` last. It refuses while any site in your worklist is still untriaged, so triage everything first.",
      "If a site's correct target state is not yours to decide, call `ask` on the orchestrator server rather than guessing.",
    ].join("\n"),
    tools: [
      tool(
        "worklist",
        "Return the sites assigned to you that still need a judgement. Call this first, and treat it as the complete and only list of work you own. Each line reads: axis, whether the file mutates data, whether it names a billing account, whether it names an involved party id, whether it carries the feature flag, then the path.",
        {
          from: z
            .string()
            .describe("your agent label, exactly as given to you"),
        },
        async (args) => {
          const cluster = ctx.activeCluster();
          const sites = ctx.store.untriagedInCluster(cluster);
          ctx.scratchpad.record(
            ctx.activeAgent(),
            ctx.currentPhase(),
            "tool_result",
            `worklist for ${cluster}: ${sites.length} sites`,
            { cluster, count: sites.length },
          );
          if (sites.length === 0) {
            return text(
              `Cluster ${cluster} has no untriaged sites. Call finish.`,
            );
          }
          const writers = sites.filter((site) => site.isWriter).length;
          const lines = sites.map(describeSite);
          return text(
            [
              `Cluster ${cluster}: ${sites.length} sites, ${writers} of them mutate data.`,
              "Judge every write path before any read path.",
              "",
              ...lines,
            ].join("\n"),
          );
        },
      ),
      tool(
        "finding",
        "Record one leftover or defect at one site. State what the code does on each side of the flag, and what the target state should be. Use severity data_loss when a write cannot be recovered later, wrong_display when a user sees the wrong name or number, and cosmetic for anything else.",
        {
          from: z.string().describe("your agent label"),
          site_path: z
            .string()
            .describe("the path exactly as the worklist gave it"),
          axis: z
            .enum(AXES)
            .describe(
              "A for a flag site, B for ownerType or ownerId indirection, C for untracked billing-account use, D for a write path",
            ),
          operation: z
            .enum(OPERATIONS)
            .describe("what the code does at this site"),
          claim: z
            .string()
            .describe("one sentence naming the leftover, in plain words"),
          behavior_flag_on: z
            .string()
            .describe("what happens when the flag is on"),
          behavior_flag_off: z
            .string()
            .describe("what happens when the flag is off"),
          target_state: z
            .string()
            .describe(
              "what the code should do once the flag is gone: remove a branch, keep the billing account, or a decision the human must make",
            ),
          severity: z.enum(SEVERITIES),
          evidence: z
            .string()
            .describe(
              "the line numbers and the symbols you read, so a checker can re-derive this without your reasoning",
            ),
        },
        async (args) => {
          const agent = ctx.activeAgent();
          const site = ctx.store.siteByPathAndAxis(args.site_path, args.axis);
          if (!site) {
            return text(
              `No census site matches ${args.site_path} on axis ${args.axis}. If this file is genuinely missing from the census, escalate it as a census gap instead of recording a finding.`,
            );
          }
          const id = `F-${args.axis}-${args.site_path.replace(/[^a-zA-Z0-9]/g, "_").slice(-60)}-${args.operation}`;
          ctx.store.upsertFinding({
            id,
            siteId: site.id,
            operation: args.operation,
            claim: args.claim,
            behaviorFlagOn: args.behavior_flag_on,
            behaviorFlagOff: args.behavior_flag_off,
            targetState: args.target_state,
            severity: args.severity,
            status: "found",
            evidence: args.evidence,
            foundBy: agent,
          });
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "note",
            `finding ${args.severity} at ${args.site_path}: ${args.claim}`,
            { id, severity: args.severity },
          );
          return text(`recorded ${id}`);
        },
      ),
      tool(
        "triage",
        "Close one site. Every site in your worklist needs exactly one triage call, including the ones that need no change. You must pass occurrences_reviewed, and it must equal the occurrence count the worklist gave for that site, so a file with three occurrences cannot be closed after reading one.",
        {
          from: z.string().describe("your agent label"),
          site_path: z
            .string()
            .describe("the path exactly as the worklist gave it"),
          axis: z.enum(AXES),
          state: z.enum(STATES),
          occurrences_reviewed: z
            .number()
            .int()
            .min(0)
            .describe(
              "how many occurrences in this file you actually read. Must equal the count the worklist reported, or this call is refused.",
            ),
          reason: z
            .string()
            .describe("one sentence, why this state and not another"),
        },
        async (args) => {
          const agent = ctx.activeAgent();
          const site = ctx.store.siteByPathAndAxis(args.site_path, args.axis);
          if (!site) {
            return text(
              `No census site matches ${args.site_path} on axis ${args.axis}. Check the worklist for the exact path.`,
            );
          }
          const expected = site.hits ?? 1;
          if (args.occurrences_reviewed !== expected) {
            return text(
              `REFUSED. ${args.site_path} on axis ${args.axis} has ${expected} occurrences and you reported reading ${args.occurrences_reviewed}. Read every one, then call triage again with occurrences_reviewed set to ${expected}.`,
            );
          }
          ctx.store.setSiteState(
            args.site_path,
            args.axis,
            args.state as SiteState,
          );
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "note",
            `triage ${args.axis} ${args.state} ${args.site_path}: ${args.reason}`,
            { axis: args.axis as SiteAxis, state: args.state },
          );
          const left = ctx.store.untriagedInCluster(ctx.activeCluster()).length;
          return text(
            `${args.site_path} set to ${args.state}. ${left} sites left.`,
          );
        },
      ),
      tool(
        "verdict",
        "Confirm or reject one finding. You did not write it and you must not trust it. Read the file yourself and re-derive the claim. Reject anything you cannot reproduce from the code.",
        {
          from: z.string().describe("your agent label"),
          finding_id: z.string(),
          status: z
            .enum(VERDICTS)
            .describe(
              "verified when you reproduced it, rejected when you could not, needs_human when the target state is a product decision",
            ),
          verdict: z
            .string()
            .describe("what you read and why you reached this status"),
        },
        async (args) => {
          const agent = ctx.activeAgent();
          ctx.store.recordVerdict(
            args.finding_id,
            args.status,
            args.verdict,
            agent,
          );
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "note",
            `verdict ${args.status} on ${args.finding_id}`,
            { findingId: args.finding_id, status: args.status },
          );
          return text(`${args.finding_id} recorded as ${args.status}`);
        },
      ),
      tool(
        "findings",
        "List findings by status. A checker asks for `found` to get its queue. A synthesist asks for `verified` to get the confirmed set. The list is ordered by severity, worst first.",
        {
          from: z.string().describe("your agent label"),
          status: z
            .enum(["found", "verified", "rejected", "needs_human"])
            .describe("which queue to read"),
        },
        async (args) => {
          const rows = ctx.store.findings(args.status);
          if (rows.length === 0)
            return text(`No findings with status ${args.status}.`);
          const lines = rows.map((row) =>
            [
              `${row.id}`,
              `  severity ${row.severity}  operation ${row.operation}`,
              `  claim: ${row.claim}`,
              `  flag on: ${row.behaviorFlagOn ?? "-"}`,
              `  flag off: ${row.behaviorFlagOff ?? "-"}`,
              `  target: ${row.targetState ?? "-"}`,
              `  evidence: ${row.evidence ?? "-"}`,
              row.verdict ? `  verdict: ${row.verdict}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return text(
            `${rows.length} findings with status ${args.status}:\n\n${lines.join("\n\n")}`,
          );
        },
      ),
      tool(
        "finish",
        "Declare your cluster complete. This is refused while any site in your worklist is still untriaged, so call triage on everything first.",
        {
          from: z.string().describe("your agent label"),
          summary: z
            .string()
            .describe("what you found, in two or three sentences"),
        },
        async (args) => {
          const agent = ctx.activeAgent();
          const cluster = ctx.activeCluster();
          const gate = clusterGate(cluster, ctx.store);
          if (!gate.ok) {
            ctx.scratchpad.record(
              agent,
              ctx.currentPhase(),
              "tool_error",
              `finish refused for ${cluster}: ${gate.reason}`,
              { cluster },
            );
            return text(`REFUSED. ${gate.reason}`);
          }
          ctx.recordHandoff(agent, args.summary);
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "handoff",
            `${cluster} complete: ${args.summary}`,
            { cluster },
          );
          return text(`${cluster} accepted. ${gate.reason}`);
        },
      ),
    ],
  });
