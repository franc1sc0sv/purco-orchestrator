import { query } from "@anthropic-ai/claude-agent-sdk";
import { MODELS } from "./types.ts";

export const LEAD_DECISIONS = [
  "answer",
  "defer",
  "continue",
  "rerun",
  "stop",
] as const;

export type LeadDecisionKind = (typeof LEAD_DECISIONS)[number];

export type LeadDecision = {
  decision: LeadDecisionKind;
  text: string;
  target?: string;
  settled?: number[];
};

export type LeadEventKind = "question" | "step_end" | "gate_card" | "grill_answer";

export type LeadEvent = {
  kind: LeadEventKind;
  body: string;
  allowed: LeadDecisionKind[];
};

export const LEAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "text"],
  properties: {
    decision: { type: "string", enum: [...LEAD_DECISIONS] },
    text: { type: "string" },
    target: { type: "string" },
    settled: { type: "array", items: { type: "integer" } },
  },
};

const LEAD_TOOLS = ["Read", "Grep", "Glob"];

export const validateDecision = (
  raw: unknown,
  allowed: LeadDecisionKind[],
): LeadDecision | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const decision = value.decision;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (typeof decision !== "string") return undefined;
  if (!allowed.includes(decision as LeadDecisionKind) && decision !== "defer") {
    return undefined;
  }
  if (text.length === 0) return undefined;
  const settled = Array.isArray(value.settled)
    ? value.settled.filter((id): id is number => Number.isInteger(id))
    : undefined;
  return {
    decision: decision as LeadDecisionKind,
    text,
    target: typeof value.target === "string" ? value.target : undefined,
    settled,
  };
};

const eventPrompt = (event: LeadEvent): string =>
  [
    `<event kind="${event.kind}">`,
    event.body,
    "</event>",
    "",
    `Allowed decisions for this event: ${[...new Set([...event.allowed, "defer"])].join(", ")}.`,
  ].join("\n");

export type LeadDeps = {
  systemPrompt: string;
  cwd: string;
  additionalDirectories: string[];
  env: Record<string, string | undefined>;
  model?: string;
  loadSession: () => string | undefined;
  saveSession: (sessionId: string) => void;
  onCost: (cumulativeUsd: number) => void;
};

export class Lead {
  private readonly deps: LeadDeps;
  private sessionId: string | undefined;

  constructor(deps: LeadDeps) {
    this.deps = deps;
    this.sessionId = deps.loadSession();
  }

  session(): string | undefined {
    return this.sessionId;
  }

  async decide(event: LeadEvent): Promise<LeadDecision> {
    let structured: unknown;
    let failure = "";
    try {
      for await (const message of query({
        prompt: eventPrompt(event),
        options: {
          systemPrompt: this.deps.systemPrompt,
          model: this.deps.model ?? MODELS.opus,
          effort: "medium",
          cwd: this.deps.cwd,
          additionalDirectories: this.deps.additionalDirectories,
          settingSources: [],
          env: this.deps.env,
          tools: LEAD_TOOLS,
          allowedTools: LEAD_TOOLS,
          permissionMode: "dontAsk",
          maxTurns: 16,
          outputFormat: { type: "json_schema", schema: LEAD_SCHEMA },
          ...(this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const id = (message as { session_id?: string }).session_id;
        if (id && id !== this.sessionId) {
          this.sessionId = id;
          this.deps.saveSession(id);
        }
        if (message.type !== "result") continue;
        this.deps.onCost(message.total_cost_usd ?? 0);
        if (message.subtype === "success") {
          structured = message.structured_output;
        } else {
          failure = message.subtype;
        }
      }
    } catch (error) {
      failure = String(error);
    }

    return (
      validateDecision(structured, event.allowed) ?? {
        decision: "defer",
        text: failure
          ? `The lead could not decide (${failure.slice(0, 200)}).`
          : "The lead returned no valid decision.",
      }
    );
  }
}
