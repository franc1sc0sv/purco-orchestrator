import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import type { WorkerMeter } from "./meter.ts";
import { touchesProtectedFile } from "./protected-files.ts";
import type { Scratchpad } from "./scratchpad.ts";
import type { SubagentTracker } from "./tracker.ts";

const PROCEED: HookJSONOutput = {};

const WRITE_STATEMENTS = [
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "comment",
  "copy",
  "call",
  "do",
  "vacuum",
  "reindex",
  "refresh",
  "set",
  "begin",
  "commit",
];

const deny = (reason: string): HookJSONOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
});

export const isReadOnlySql = (sql: string): boolean => {
  const stripped = sql
    .split("\n")
    .map((line) => line.split("--")[0])
    .join(" ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .toLowerCase();
  if (stripped.length === 0) return false;
  const first = stripped.split(/[\s(]+/)[0];
  if (WRITE_STATEMENTS.includes(first)) return false;
  if (
    !["select", "explain", "with", "show", "table", "values"].includes(first)
  ) {
    return false;
  }
  for (const statement of WRITE_STATEMENTS) {
    const pattern = new RegExp(`(^|[\\s;(])${statement}[\\s(]`, "i");
    if (statement === "set" || statement === "create") continue;
    if (pattern.test(stripped)) return false;
  }
  return true;
};

export const describeInput =(input: Record<string, unknown>): string => {
  const interesting = [
    "command",
    "file_path",
    "pattern",
    "path",
    "prompt",
    "description",
    "subagent_type",
    "url",
  ];
  for (const key of interesting) {
    const value = input?.[key];
    if (typeof value === "string" && value.length > 0) {
      return `${key}=${value.replace(/\s+/g, " ").slice(0, 140)}`;
    }
  }
  return "";
};

const WRITING_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export const buildHooks = (deps: {
  scratchpad: Scratchpad;
  tracker: SubagentTracker;
  recordFileWritten: (file: string) => void;
  refuse?: (tool: string, input: Record<string, unknown>) => string | undefined;
  meter?: WorkerMeter;
}): Partial<Record<HookEvent, HookCallbackMatcher[]>> => {
  const { scratchpad, tracker, recordFileWritten, refuse, meter } = deps;

  const onPreToolUse = async (
    input: HookInput,
    toolUseId: string | undefined,
  ): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return PROCEED;
    tracker.bindToolUse(toolUseId);
    tracker.countToolCall();

    if (input.tool_name.endsWith("__execute_sql")) {
      const sql = String((input.tool_input as { sql?: unknown }).sql ?? "");
      if (!isReadOnlySql(sql)) {
        scratchpad.record(
          tracker.active(),
          tracker.currentPhase(),
          "permission_denied",
          `blocked non-read SQL on ${input.tool_name}`,
          { sql: sql.slice(0, 300) },
        );
        return deny(
          "Only read-only SQL is allowed in an orchestrated run. Rewrite it as a SELECT or EXPLAIN, or escalate at level human.",
        );
      }
    }
    const refusal = refuse?.(input.tool_name, input.tool_input as Record<string, unknown>);
    if (refusal) {
      scratchpad.record(
        tracker.active(),
        tracker.currentPhase(),
        "permission_denied",
        `blocked ${input.tool_name}: ${refusal}`,
        { tool: input.tool_name },
      );
      return deny(refusal);
    }
    if (touchesProtectedFile(input.tool_input as Record<string, unknown>)) {
      scratchpad.record(
        tracker.active(),
        tracker.currentPhase(),
        "permission_denied",
        `blocked ${input.tool_name} on a protected file`,
        { tool: input.tool_name },
      );
      return deny(
        "That file is protected: dotenv files, keys and credentials are never read in an orchestrated run. If you need a value from it, escalate at level human.",
      );
    }
    meter?.toolStart(input.tool_name, input.tool_input as Record<string, unknown>);
    const detail = describeInput(input.tool_input as Record<string, unknown>);
    scratchpad.record(
      tracker.active(),
      tracker.currentPhase(),
      "tool_use",
      detail ? `${input.tool_name} ${detail}` : input.tool_name,
      { toolUseId, tool: input.tool_name },
    );
    return PROCEED;
  };

  const onPostToolUse = async (
    input: HookInput,
    toolUseId: string | undefined,
  ): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUse") return PROCEED;
    meter?.toolEnd(input.tool_name, input.tool_input as Record<string, unknown>);
    if (WRITING_TOOLS.has(input.tool_name)) {
      const file = (input.tool_input as { file_path?: unknown }).file_path;
      if (typeof file === "string" && file.length > 0) recordFileWritten(file);
    }
    scratchpad.record(
      tracker.active(),
      tracker.currentPhase(),
      "tool_result",
      input.tool_name,
      { toolUseId },
    );
    return PROCEED;
  };

  const onPostToolUseFailure = async (
    input: HookInput,
    toolUseId: string | undefined,
  ): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUseFailure") return PROCEED;
    tracker.countFailure();
    meter?.toolEnd(input.tool_name, input.tool_input as Record<string, unknown>);
    const agent = tracker.active();
    const raw = (input as { error?: unknown }).error;
    const reason =
      typeof raw === "string"
        ? raw.slice(0, 400)
        : JSON.stringify(raw ?? {}).slice(0, 400);
    scratchpad.record(
      agent,
      tracker.currentPhase(),
      "tool_error",
      `${input.tool_name} failed — ${reason}`,
      { toolUseId, tool: input.tool_name },
    );
    return PROCEED;
  };

  const onPermissionDenied = async (
    input: HookInput,
  ): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PermissionDenied") return PROCEED;
    scratchpad.record(
      tracker.active(),
      tracker.currentPhase(),
      "permission_denied",
      `denied ${input.tool_name}`,
      { tool: input.tool_name },
    );
    return PROCEED;
  };

  const onSubagentStart = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "SubagentStart") return PROCEED;
    tracker.start({
      agentId: input.agent_id,
      agentType: input.agent_type,
    });
    return PROCEED;
  };

  const onSubagentStop = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "SubagentStop") return PROCEED;
    tracker.stop(input.agent_id, input.last_assistant_message);
    return PROCEED;
  };

  const one = (hook: HookCallbackMatcher["hooks"][number]) => [
    { hooks: [hook] },
  ];

  return {
    PreToolUse: one(onPreToolUse),
    PostToolUse: one(onPostToolUse),
    PostToolUseFailure: one(onPostToolUseFailure),
    PermissionDenied: one(onPermissionDenied),
    SubagentStart: one(onSubagentStart),
    SubagentStop: one(onSubagentStop),
  };
};
