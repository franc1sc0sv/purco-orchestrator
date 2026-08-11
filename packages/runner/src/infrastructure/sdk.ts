import type { AgentMap } from "./briefs.ts";
import { MCP_SERVER_KEY, MCP_SERVER_PATH } from "./install.ts";
import { EMPTY_USAGE } from "./spend.ts";
import type { CycleUsage } from "./spend.ts";
import {
  ALLOWED_TOOLS,
  DENIED_TOOLS,
  permissionAnswer,
  standingOrders,
} from "./standing-orders.ts";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type CycleEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "task"; description: string }
  | { kind: "notice"; text: string };

export type CycleRequest = {
  prompt: string;
  cwd: string;
  projectRoot: string;
  agents: AgentMap;
  systemPromptAppend: string;
  resume: string | null;
  abortController: AbortController;
  onEvent: (event: CycleEvent) => void;
};

export type CycleOutcome = {
  usage: CycleUsage;
  resultText: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (value: unknown, key: string): string => {
  if (!isRecord(value)) return "";
  const found = value[key];
  return typeof found === "string" ? found : "";
};

const toolLabel = (name: string, input: unknown): string => {
  if (name !== "Agent" && name !== "Task") return name;
  const detail =
    stringAt(input, "subagent_type") || stringAt(input, "description") || "?";
  return `${name}(${detail})`;
};

const usageOf = (message: SDKResultMessage): CycleUsage => ({
  outputTokens: message.usage.output_tokens ?? 0,
  inputTokens: message.usage.input_tokens ?? 0,
  cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
  costUsd: message.total_cost_usd ?? 0,
});

const emitAssistant = (
  message: Extract<SDKMessage, { type: "assistant" }>,
  onEvent: (event: CycleEvent) => void
): void => {
  for (const block of message.message.content) {
    if (block.type === "text" && block.text.trim().length > 0) {
      onEvent({ kind: "text", text: block.text.trimEnd() });
    }
    if (block.type === "tool_use") {
      onEvent({ kind: "tool", label: toolLabel(block.name, block.input) });
    }
  }
};

export const runCycle = async ({
  prompt,
  cwd,
  projectRoot,
  agents,
  systemPromptAppend,
  resume,
  abortController,
  onEvent,
}: CycleRequest): Promise<CycleOutcome> => {
  const stream = query({
    prompt,
    options: {
      cwd,
      agents,
      abortController,
      ...(resume === null ? {} : { resume }),
      allowedTools: [...ALLOWED_TOOLS],
      disallowedTools: [...DENIED_TOOLS],
      permissionMode: "acceptEdits",
      canUseTool: permissionAnswer(projectRoot),
      settingSources: ["user", "project"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: systemPromptAppend,
      },
      mcpServers: {
        [MCP_SERVER_KEY]: {
          type: "stdio",
          command: process.execPath,
          args: [MCP_SERVER_PATH],
        },
      },
      hooks: standingOrders(projectRoot),
    },
  });

  let usage: CycleUsage = { ...EMPTY_USAGE };
  let resultText = "";

  for await (const message of stream) {
    if (message.type === "assistant") {
      emitAssistant(message, onEvent);
      continue;
    }
    if (message.type === "system" && message.subtype === "init") {
      onEvent({ kind: "session", sessionId: message.session_id });
      continue;
    }
    if (message.type === "system" && message.subtype === "task_started") {
      onEvent({ kind: "task", description: message.description });
      continue;
    }
    if (message.type === "result") {
      usage = usageOf(message);
      if (message.subtype === "success") resultText = message.result;
      else
        onEvent({
          kind: "notice",
          text: `Cycle ended with ${message.subtype}.`,
        });
    }
  }

  return { usage, resultText };
};
