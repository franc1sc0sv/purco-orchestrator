import { MCP_SERVER_KEY, MCP_TOOL_PREFIX, TESTING_ROOT } from "./install.ts";
import type {
  CanUseTool,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { isAbsolute, relative, resolve } from "node:path";

export const CORE_TOOLS: readonly string[] = [
  "Agent",
  "Task",
  "Skill",
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "BashOutput",
  "KillShell",
  "TodoWrite",
];

export const ALLOWED_TOOLS: readonly string[] = [
  ...CORE_TOOLS,
  `mcp__${MCP_SERVER_KEY}`,
];

export const DENIED_TOOLS: readonly string[] = [
  "Bash(git:*)",
  "Bash(gh:*)",
  "Bash(sudo:*)",
  "Bash(rm:*)",
  "WebFetch",
  "WebSearch",
];

const SECRET_ALLOW = /\.env\.(example|sample|template|test)$/i;
const SECRET_DENY = [
  /(^|\/)\.env($|\.)/i,
  /\.pem$/i,
  /(^|\/)id_(rsa|ed25519)/i,
  /(^|\/)secrets?\//i,
  /credential/i,
  /(^|\/)\.ssh\//i,
];
const TEST_PATH =
  /[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__|e2e|cypress|playwright|fixtures)\//i;
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);
const PATH_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (input: unknown, key: string): string => {
  if (!isRecord(input)) return "";
  const value = input[key];
  return typeof value === "string" ? value : "";
};

const pathOf = (input: unknown): string =>
  stringAt(input, "file_path") ||
  stringAt(input, "notebook_path") ||
  stringAt(input, "path");

const insideRoot = (value: string, root: string): boolean => {
  const rel = relative(root, value);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
};

const isSecretPath = (value: string): boolean =>
  !SECRET_ALLOW.test(value) &&
  SECRET_DENY.some((pattern) => pattern.test(value));

export const refusal = (
  toolName: string,
  input: unknown,
  projectRoot: string
): string | null => {
  if (toolName === "Bash") {
    const command = stringAt(input, "command");
    for (const segment of command.split(/[;&|]+|\$\(|`/)) {
      const first = segment.trim().split(/\s+/)[0] ?? "";
      if (first === "git" || first.endsWith("/git")) {
        return "Standing order: Test Forge never runs git commands.";
      }
    }
    for (const word of command.split(/\s+/)) {
      const bare = word.replace(/^["']|["']$/g, "");
      if (bare.length > 0 && isSecretPath(bare)) {
        return `Standing order: Test Forge never reads secrets. "${bare}" is a protected path.`;
      }
    }
    return null;
  }

  if (!PATH_TOOLS.has(toolName)) return null;

  const target = pathOf(input);
  if (target.length === 0) return null;
  const full = isAbsolute(target) ? target : resolve(projectRoot, target);

  if (isSecretPath(full)) {
    return `Standing order: Test Forge never reads or writes secrets. "${target}" is a protected path.`;
  }
  if (!WRITE_TOOLS.has(toolName)) return null;
  if (insideRoot(full, TESTING_ROOT)) return null;
  if (!insideRoot(full, projectRoot)) return null;
  if (TEST_PATH.test(full)) return null;

  return `Standing order: Test Forge never edits production code. "${target}" is not a test file. Record it as a finding for Noble Team instead.`;
};

export const standingOrders = (
  projectRoot: string
): Partial<Record<HookEvent, HookCallbackMatcher[]>> => {
  const check = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = refusal(input.tool_name, input.tool_input, projectRoot);
    if (reason === null) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };

  return { PreToolUse: [{ hooks: [check] }] };
};

export const permissionAnswer =
  (projectRoot: string): CanUseTool =>
  async (toolName, input): Promise<PermissionResult> => {
    const reason = refusal(toolName, input, projectRoot);
    if (reason !== null) return { behavior: "deny", message: reason };

    const permitted =
      CORE_TOOLS.includes(toolName) || toolName.startsWith(MCP_TOOL_PREFIX);
    if (!permitted) {
      return {
        behavior: "deny",
        message: `${toolName} is not part of the Test Forge tool set. Use a Roland tool or a Blue Team author.`,
      };
    }
    return { behavior: "allow", updatedInput: input };
  };
