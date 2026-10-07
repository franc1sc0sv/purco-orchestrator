import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { recordEngineLimit } from "./limits.ts";
import type { Scratchpad } from "./scratchpad.ts";
import type { SubagentTracker } from "./tracker.ts";

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
};

export type StreamTotals = {
  costUsd: number;
  turns: number;
  usage: TokenUsage;
  sessionId?: string;
  result?: string;
  errors: string[];
  subtype?: string;
  refusal?: string;
};

export const noUsage = (): TokenUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
});

export const newTotals = (): StreamTotals => ({
  costUsd: 0,
  turns: 0,
  usage: noUsage(),
  errors: [],
});

export const readUsage =(raw: unknown): TokenUsage => {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (key: string): number =>
    typeof u[key] === "number" ? (u[key] as number) : 0;
  return {
    input: n("input_tokens"),
    output: n("output_tokens"),
    cacheRead: n("cache_read_input_tokens"),
    cacheCreation: n("cache_creation_input_tokens"),
  };
};

export const totalTokens = (usage: TokenUsage): number =>
  usage.input + usage.output + usage.cacheRead + usage.cacheCreation;

const REFUSAL_MARKERS = [
  "safeguards flagged this message",
  "Claude Code can't respond to this message",
  "reasoning_extraction",
  "API Error:",
];

export const detectRefusal = (text: string): string | undefined => {
  for (const marker of REFUSAL_MARKERS) {
    if (text.includes(marker)) return text.trim().slice(0, 600);
  }
  return undefined;
};

const AGENT_TOOLS = new Set(["Agent", "Task"]);

export const handleMessage = (
  message: SDKMessage,
  deps: { scratchpad: Scratchpad; tracker: SubagentTracker },
  totals: StreamTotals,
): void => {
  const { scratchpad, tracker } = deps;

  if (message.type === "rate_limit_event") {
    recordEngineLimit(message.rate_limit_info);
    return;
  }

  if (message.type === "system") {
    if (message.subtype === "init") {
      totals.sessionId = message.session_id;
      scratchpad.record(
        tracker.active(),
        tracker.currentPhase(),
        "note",
        `session ${message.session_id} initialised`,
        { model: (message as { model?: string }).model },
      );
    }
    return;
  }

  if (message.type === "assistant") {
    tracker.setContextFromMessage(message.parent_tool_use_id);
    const agent = tracker.active();
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim().length > 0) {
        scratchpad.record(
          agent,
          tracker.currentPhase(),
          "text",
          block.text,
          {},
        );
      } else if (block.type === "thinking") {
        const thought = (block as { thinking?: string }).thinking ?? "";
        if (thought.trim().length > 0) {
          scratchpad.record(agent, tracker.currentPhase(), "thinking", thought);
        }
      } else if (block.type === "tool_use") {
        if (AGENT_TOOLS.has(block.name)) {
          const input = block.input as {
            subagent_type?: string;
            description?: string;
            prompt?: string;
          };
          tracker.bindToolUse(block.id);
          scratchpad.record(
            agent,
            tracker.currentPhase(),
            "spawn",
            `delegating to ${input.subagent_type ?? "unknown"}: ${input.description ?? ""}`,
            {
              toolUseId: block.id,
              subagentType: input.subagent_type,
              promptPreview: input.prompt?.slice(0, 400),
            },
          );
        }
      }
    }
    return;
  }

  if (message.type === "result") {
    totals.costUsd = message.total_cost_usd ?? 0;
    totals.turns = message.num_turns ?? 0;
    totals.usage = readUsage((message as { usage?: unknown }).usage);
    totals.subtype = message.subtype;
    if (message.subtype === "success") {
      totals.result = message.result;
      totals.refusal = detectRefusal(message.result);
    } else {
      totals.errors.push(...(message.errors ?? []));
    }
    scratchpad.record(
      tracker.active(),
      tracker.currentPhase(),
      "cost",
      `result ${message.subtype} — ${totals.turns} turns, $${totals.costUsd.toFixed(4)}, ${totalTokens(totals.usage)} tokens`,
      { subtype: message.subtype, errors: totals.errors, usage: totals.usage },
    );
  }
};
