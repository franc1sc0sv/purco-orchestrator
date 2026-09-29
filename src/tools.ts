import fs from "node:fs";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentScratch } from "./agent-scratch.ts";
import type { EscalationRegistry } from "./escalation.ts";
import type { MessageBus } from "./bus.ts";
import type { Scratchpad } from "./scratchpad.ts";
import { ROLES, type Phase, type RoleName } from "./types.ts";

export const SERVER_NAME = "orch";

export const ORCH_TOOL_NAMES = [
  "note",
  "think",
  "ask",
  "escalate",
  "report",
  "inbox",
  "handoff",
  "scratch_write",
  "scratch_read",
].map((name) => `mcp__${SERVER_NAME}__${name}`);

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

const json = (payload: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify(payload, null, 2) },
  ],
});

export type HandoffInput = {
  summary: string;
  outputPath?: string;
  produced: string[];
  openQuestions: number;
  status: "complete" | "partial";
};

export type ToolContext = {
  scratchpad: Scratchpad;
  bus: MessageBus;
  escalations: EscalationRegistry;
  scratch: AgentScratch;
  currentPhase: () => Phase | "run";
  currentRole: () => RoleName;
  activeAgent: () => string;
  resolvePath: (candidate: string) => string;
  recordHandoff: (agent: string, handoff: HandoffInput) => void;
};

const LEVELS = ["retry", "repair", "orchestrator", "human", "abort"] as const;

export const buildOrchestratorServer = (ctx: ToolContext) => {
  const who = (claimed: string): string => {
    const observed = ctx.activeAgent();
    if (!claimed) return observed;
    const normalised = claimed.toUpperCase();
    const sameAgent =
      normalised === observed || observed.startsWith(`${normalised}-`);
    if (observed !== "ORCHESTRATOR" && !sameAgent) {
      ctx.scratchpad.record(
        observed,
        ctx.currentPhase(),
        "note",
        `identity mismatch: tool call claimed ${normalised}, tracker observed ${observed}`,
        { claimed: normalised, observed }
      );
    }
    return sameAgent ? observed : normalised;
  };

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: "0.1.0",
    instructions: [
      "You are one agent in an orchestrated run. Use these tools to stay visible and to communicate.",
      "Always pass `from` as your own agent label, exactly as it was given to you.",
      "Call `note` when you start a unit of work and when you finish one.",
      "Call `think` to write down a decision and its rationale, the way you would annotate a design note.",
      "Call `ask` when a decision is not yours to make. It blocks and returns an answer. Do not guess instead of asking.",
      "Call `escalate` when you are blocked. Pick the lowest level that can actually resolve it.",
      "Call `report` to tell the orchestrator something; set for_role to have it handed to a later phase. You cannot message another agent directly.",
      "Call `inbox` once at the start to read what the orchestrator handed you.",
      "Call `handoff` exactly once, at the end, naming every file you wrote. The orchestrator checks they exist.",
      "Call `scratch_write` as you finish each unit of work, and `scratch_read` first when your task says the phase was resumed. That scratchpad is yours alone and survives an interrupted run.",
    ].join("\n"),
    tools: [
      tool(
        "note",
        "Record a progress note. Call it when you begin a unit of work and when you finish one.",
        {
          from: z.string(),
          stage: z.enum(["start", "progress", "done"]),
          unit: z.string().describe("the unit of work, in three to six words"),
          text: z.string(),
        },
        async (args) => {
          const agent = who(args.from);
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "note",
            `[${args.stage}] ${args.unit}: ${args.text}`,
            { stage: args.stage, unit: args.unit, text: args.text }
          );
          return json({ ok: true, recorded: args.stage });
        }
      ),

      tool(
        "think",
        "Record a decision you just made and why, so the human can audit it later. One decision per call, not a running commentary.",
        {
          from: z.string(),
          decision: z.string().describe("what you chose, in one sentence"),
          because: z.string().describe("the reason, in one or two sentences"),
          rejected: z
            .string()
            .optional()
            .describe("the alternative you did not take"),
          evidence: z
            .string()
            .optional()
            .describe("the file, line, ADR or table that settles it"),
        },
        async (args) => {
          const agent = who(args.from);
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "thinking",
            `${args.decision} — because ${args.because}`,
            {
              decision: args.decision,
              because: args.because,
              rejected: args.rejected,
              evidence: args.evidence,
            }
          );
          return json({ ok: true });
        }
      ),

      tool(
        "ask",
        "Ask the orchestrator a question and wait for its answer. Use this instead of guessing when a decision is outside your scope.",
        {
          from: z.string(),
          question: z.string().describe("one sentence, answerable as written"),
          options: z
            .array(z.string())
            .optional()
            .describe("the answers you would accept, two to four"),
          recommended: z
            .string()
            .optional()
            .describe("the option you would pick"),
          why: z.string().optional(),
          context: z.string().optional(),
        },
        async (args) => {
          const agent = who(args.from);
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "question",
            args.question,
            {
              why: args.why,
              options: args.options,
              recommended: args.recommended,
            }
          );
          const escalation = await ctx.escalations.raise({
            from: agent,
            phase: ctx.currentPhase(),
            level: "orchestrator",
            summary: args.question,
            detail: args.why,
            context: args.context,
          });
          const answer =
            ctx.escalations.resolutionFor(escalation.id) ??
            "No answer available. State your assumption in your report and continue.";
          ctx.scratchpad.record(agent, ctx.currentPhase(), "answer", answer, {
            escalationId: escalation.id,
          });
          return json({ escalationId: escalation.id, answer });
        }
      ),

      tool(
        "escalate",
        "Raise a blocker. Levels: retry (transient, you will try a different way), repair (you can fix it yourself), orchestrator (needs a decision above you), human (only the user can decide), abort (an invariant broke and the run must stop).",
        {
          from: z.string(),
          level: z.enum(LEVELS),
          summary: z.string(),
          detail: z.string().optional(),
          blocker: z.string().optional(),
          repeat_key: z.string().optional(),
        },
        async (args) => {
          const agent = who(args.from);
          const escalation = await ctx.escalations.raise({
            from: agent,
            phase: ctx.currentPhase(),
            level: args.level,
            summary: args.summary,
            detail: args.detail,
            blocker: args.blocker,
            repeatKey: args.repeat_key,
          });
          if (escalation.level === "abort") {
            return {
              ...text(
                `Escalation ${escalation.id} recorded as ABORT. Stop work now and return your report.`
              ),
              isError: true,
            };
          }
          const resolution =
            ctx.escalations.resolutionFor(escalation.id) ??
            "Recorded. Continue and state the risk in your report.";
          return text(`[${escalation.id}] ${resolution}`);
        }
      ),

      tool(
        "report",
        "Report something to the orchestrator. You cannot message another agent: agents run one at a time and never overlap, so only the orchestrator persists between phases. Set for_role when the information must reach a later phase, and the orchestrator will hand it to that role when it starts.",
        {
          from: z.string(),
          kind: z
            .enum(["finding", "risk", "fact", "blocker", "progress"])
            .describe("what sort of thing this is"),
          subject: z.string().describe("one line"),
          body: z.string(),
          for_role: z.enum(ROLES).optional(),
        },
        async (args) => {
          const agent = who(args.from);
          const message = ctx.bus.report({
            from: agent,
            subject: `[${args.kind}] ${args.subject}`,
            body: args.body,
            forRole: args.for_role,
            phase: ctx.currentPhase(),
          });
          return json({
            id: message.id,
            relayTo: args.for_role ?? null,
          });
        }
      ),

      tool(
        "inbox",
        "Read what the orchestrator has handed to you for this phase. Call it once when you start.",
        { from: z.string() },
        async (args) => {
          const agent = who(args.from);
          const delivered = ctx.bus.relayedTo(agent);
          if (delivered.length > 0) {
            ctx.scratchpad.record(
              agent,
              ctx.currentPhase(),
              "message",
              `read ${delivered.length} handed message(s)`,
              { ids: delivered.map((m) => m.id) }
            );
          }
          return json({
            count: delivered.length,
            messages: delivered.map((m) => ({
              id: m.id,
              from: m.from,
              subject: m.subject,
              body: m.body,
            })),
          });
        }
      ),

      tool(
        "handoff",
        "Declare your phase output. Call this once, at the end. The orchestrator checks that every file you name exists, and refuses the handoff if one does not.",
        {
          from: z.string(),
          summary: z.string().describe("what you did, in two or three lines"),
          output_path: z
            .string()
            .optional()
            .describe("your main output file"),
          produced: z
            .array(z.string())
            .default([])
            .describe("every file you created or changed"),
          open_questions: z
            .number()
            .int()
            .min(0)
            .default(0)
            .describe("how many decisions you could not settle"),
          status: z
            .enum(["complete", "partial"])
            .describe("partial when you did not finish your task"),
        },
        async (args) => {
          const agent = who(args.from);
          const named = [
            ...(args.output_path ? [args.output_path] : []),
            ...args.produced,
          ];
          const missing = named.filter(
            (file) => !fs.existsSync(ctx.resolvePath(file))
          );
          if (missing.length > 0) {
            ctx.scratchpad.record(
              agent,
              ctx.currentPhase(),
              "tool_error",
              `handoff refused: ${missing.join(", ")} do not exist`,
              { missing }
            );
            return {
              ...json({
                accepted: false,
                missing,
                fix: "Write the file, or name only the files you really wrote, then call handoff again.",
              }),
              isError: true,
            };
          }
          ctx.recordHandoff(agent, {
            summary: args.summary,
            outputPath: args.output_path,
            produced: args.produced,
            openQuestions: args.open_questions,
            status: args.status,
          });
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "handoff",
            args.summary,
            {
              outputPath: args.output_path,
              produced: args.produced,
              openQuestions: args.open_questions,
              status: args.status,
            }
          );
          return json({ accepted: true, files: named.length });
        }
      ),

      tool(
        "scratch_write",
        "Save a keyed note to your own scratchpad, so a later attempt at this phase can read it. Write one entry per unit of work, keyed by that unit. Writing the same key again replaces it. Keep each value short: it is state, not a transcript.",
        {
          from: z.string(),
          key: z.string().describe("a stable key, such as the file or slice"),
          value: z.string().describe("what is true now, in a few lines"),
        },
        async (args) => {
          const agent = who(args.from);
          const entries = ctx.scratch.write(
            ctx.currentRole(),
            args.key,
            args.value
          );
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "note",
            `scratch ${args.key}`,
            { key: args.key }
          );
          return json({ ok: true, entries: entries.length });
        }
      ),

      tool(
        "scratch_read",
        "Read back your own scratchpad. Call it first when your task says this phase was resumed. You see only your own role's entries.",
        { from: z.string() },
        async (args) => {
          who(args.from);
          const entries = ctx.scratch.read(ctx.currentRole());
          return json({ count: entries.length, entries });
        }
      ),
    ],
  });
};
