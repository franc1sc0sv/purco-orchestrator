import fs from "node:fs";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentScratch } from "./agent-scratch.ts";
import type { EscalationRegistry } from "./escalation.ts";
import type { MessageBus } from "./bus.ts";
import type { Scratchpad } from "./scratchpad.ts";
import { parseHandoff } from "./handoff.ts";
import {
  OUTCOME_KINDS,
  ROLES,
  type Phase,
  type RoleName,
  type StepResult,
} from "./types.ts";

export const SERVER_NAME = "orch";

export const ORCH_TOOL_NAMES = [
  "note",
  "think",
  "ask",
  "escalate",
  "report",
  "handoff",
  "scratch_write",
  "scratch_read",
].map((name) => `mcp__${SERVER_NAME}__${name}`);

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload) }],
});

export type HandoffInput = StepResult;

export type ToolContext = {
  scratchpad: Scratchpad;
  escalations: EscalationRegistry;
  bus: MessageBus;
  scratch: AgentScratch;
  currentPhase: () => Phase | "run";
  currentRole: () => RoleName;
  activeAgent: () => string;
  resolvePath: (candidate: string) => string;
  recordHandoff: (agent: string, handoff: HandoffInput) => void;
};

const LEVELS = ["retry", "repair", "orchestrator", "human", "abort"] as const;

export const buildOrchestratorServer = (ctx: ToolContext) =>
  createSdkMcpServer({
    name: SERVER_NAME,
    version: "0.2.0",
    instructions: [
      "These tools connect you to the orchestrator of this run.",
      "Use `note` at the milestones of your task, and `think` for a decision a reviewer should be able to audit.",
      "Use `ask` when a decision is not yours to make. It blocks and returns an answer.",
      "Use `escalate` when you are blocked, at the lowest level that can resolve it.",
      "Use `report` to pass something to a later role through the orchestrator.",
      "Use `scratch_write` after each unit of work and `scratch_read` first when the task says the step was resumed.",
      "Call `handoff` once, at the end, naming every file you wrote.",
    ].join("\n"),
    tools: [
      tool(
        "note",
        "Record a progress note at a milestone of your task.",
        {
          stage: z.enum(["start", "progress", "done"]),
          unit: z.string().describe("the unit of work, in three to six words"),
          text: z.string(),
        },
        async (args) => {
          ctx.scratchpad.record(
            ctx.activeAgent(),
            ctx.currentPhase(),
            "note",
            `[${args.stage}] ${args.unit}: ${args.text}`,
            { stage: args.stage, unit: args.unit, text: args.text },
          );
          return json({ ok: true });
        },
      ),

      tool(
        "think",
        "Record one decision and its reason, so a reviewer can audit it later. Give the conclusion and the evidence, not a transcript of your reasoning.",
        {
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
          ctx.scratchpad.record(
            ctx.activeAgent(),
            ctx.currentPhase(),
            "thinking",
            `${args.decision} — because ${args.because}`,
            {
              decision: args.decision,
              because: args.because,
              rejected: args.rejected,
              evidence: args.evidence,
            },
          );
          return json({ ok: true });
        },
      ),

      tool(
        "ask",
        "Ask the orchestrator a question and wait for the answer. Use it instead of guessing when a decision is outside your scope.",
        {
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
          const agent = ctx.activeAgent();
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "question",
            args.question,
            {
              why: args.why,
              options: args.options,
              recommended: args.recommended,
            },
          );
          const detail = [
            args.why ? `Why: ${args.why}` : "",
            args.options?.length
              ? `Options: ${args.options.join(" | ")}`
              : "",
            args.recommended ? `Recommended: ${args.recommended}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          const escalation = await ctx.escalations.raise({
            from: agent,
            phase: ctx.currentPhase(),
            level: "orchestrator",
            summary: args.question,
            detail: detail || undefined,
            context: args.context,
          });
          const answer =
            ctx.escalations.resolutionFor(escalation.id) ??
            "No answer is available. State your assumption in your output and continue.";
          ctx.scratchpad.record(agent, ctx.currentPhase(), "answer", answer, {
            escalationId: escalation.id,
          });
          return json({ escalationId: escalation.id, answer });
        },
      ),

      tool(
        "escalate",
        "Raise a blocker. Levels: retry (transient, you will try a different way), repair (you can fix it yourself), orchestrator (needs a decision above you), human (only the user can decide), abort (an invariant broke and the run must stop).",
        {
          level: z.enum(LEVELS),
          summary: z.string(),
          detail: z.string().optional(),
          blocker: z.string().optional(),
          repeat_key: z.string().optional(),
        },
        async (args) => {
          const escalation = await ctx.escalations.raise({
            from: ctx.activeAgent(),
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
                `Escalation ${escalation.id} is recorded as ABORT. Stop work now and call handoff with status failed.`,
              ),
              isError: true,
            };
          }
          const resolution =
            ctx.escalations.resolutionFor(escalation.id) ??
            "Recorded. Continue and state the risk in your output.";
          return text(`[${escalation.id}] ${resolution}`);
        },
      ),

      tool(
        "report",
        "Pass something to the orchestrator. Agents run one at a time, so only the orchestrator lives across the whole run. Set for_role when a later role needs it; the orchestrator puts it in that role's task when it starts.",
        {
          kind: z
            .enum(["finding", "risk", "fact", "blocker", "progress"])
            .describe("what sort of thing this is"),
          subject: z.string().describe("one line"),
          body: z.string(),
          for_role: z.enum(ROLES).optional(),
        },
        async (args) => {
          const message = ctx.bus.report({
            from: ctx.activeAgent(),
            subject: `[${args.kind}] ${args.subject}`,
            body: args.body,
            forRole: args.for_role,
            phase: ctx.currentPhase(),
          });
          return json({ id: message.id, relayTo: args.for_role ?? null });
        },
      ),

      tool(
        "handoff",
        "Declare the outcome of your step. Call it once, at the end. The orchestrator checks the shape of the handoff and that every file you name exists, and refuses the handoff when either is wrong.",
        {
          status: z
            .enum(OUTCOME_KINDS)
            .describe(
              "delivered: the task is done. blocked: you cannot go on without a decision. disputed: the evidence contradicts the task or a rule. failed: you could not do it.",
            ),
          summary: z.string().describe("what you did, in two or three lines"),
          output_path: z.string().optional().describe("your main output file"),
          produced: z
            .array(z.string())
            .optional()
            .describe("every file you created or changed"),
          open_questions: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("how many decisions you could not settle"),
          evidence: z
            .string()
            .optional()
            .describe("required unless status is delivered: the file, line or tool result behind it"),
          counts: z
            .object({})
            .catchall(z.unknown())
            .optional()
            .describe("optional object of numbers that measure your result, for example {\"files_changed\": 4}"),
          findings: z
            .array(z.unknown())
            .optional()
            .describe("optional list of {title, severity, location} for each defect or risk you found"),
        },
        async (args) => {
          const agent = ctx.activeAgent();
          const parsed = parseHandoff(args);
          if (!parsed.ok) {
            ctx.scratchpad.record(
              agent,
              ctx.currentPhase(),
              "tool_error",
              `handoff refused: ${parsed.fix.slice(0, 300)}`,
            );
            return {
              ...json({ accepted: false, fix: parsed.fix }),
              isError: true,
            };
          }
          const handoff = parsed.result;
          const named = [
            ...(handoff.outputPath ? [handoff.outputPath] : []),
            ...handoff.produced,
          ];
          const missing = named.filter(
            (file) => !fs.existsSync(ctx.resolvePath(file)),
          );
          if (missing.length > 0) {
            ctx.scratchpad.record(
              agent,
              ctx.currentPhase(),
              "tool_error",
              `handoff refused: ${missing.join(", ")} do not exist`,
              { missing },
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
          ctx.recordHandoff(agent, handoff);
          ctx.scratchpad.record(
            agent,
            ctx.currentPhase(),
            "handoff",
            `${handoff.status}: ${handoff.summary}`,
            { ...handoff },
          );
          return json({ accepted: true, files: named.length });
        },
      ),

      tool(
        "scratch_write",
        "Save a keyed note to your own scratchpad, so a later attempt at this step can read it. One entry per unit of work, keyed by that unit. Writing a key again replaces it. Keep it short: it is state, not a transcript.",
        {
          key: z.string().describe("a stable key, such as the file or slice"),
          value: z.string().describe("what is true now, in a few lines"),
        },
        async (args) => {
          const entries = ctx.scratch.write(
            ctx.currentRole(),
            args.key,
            args.value,
          );
          ctx.scratchpad.record(
            ctx.activeAgent(),
            ctx.currentPhase(),
            "note",
            `scratch ${args.key}`,
            { key: args.key },
          );
          return json({ ok: true, entries: entries.length });
        },
      ),

      tool(
        "scratch_read",
        "Read back your own scratchpad. Call it first when your task says this step was resumed.",
        {},
        async () => {
          const entries = ctx.scratch.read(ctx.currentRole());
          return json({ count: entries.length, entries });
        },
      ),
    ],
  });
