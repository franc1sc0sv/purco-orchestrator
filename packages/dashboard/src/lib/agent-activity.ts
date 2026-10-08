import type { StreamEvent, Worker } from "@/lib/types";

export const LANES = ["Bash", "Read", "Edit", "MCP", "Other"] as const;
export type Lane = (typeof LANES)[number];

export type CommandStatus = "running" | "ok" | "failed" | "lost";

export type Command = {
  at: number;
  tool: string;
  cmd: string;
  ms: number | null;
  status: CommandStatus;
  lane: Lane;
};

const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const MUTATION_PREFIX = "mcp__test-forge__mutation_";

export const laneOf = (tool: string): Lane => {
  if (tool === "Bash") return "Bash";
  if (READ_TOOLS.has(tool)) return "Read";
  if (EDIT_TOOLS.has(tool)) return "Edit";
  if (tool.startsWith("mcp__")) return "MCP";
  return "Other";
};

export const toolLabel = (tool: string): string => (tool.startsWith("mcp__") ? (tool.split("__").pop() ?? tool) : tool);

export const shortTarget = (cmd: string): string => {
  const flat = cmd.replace(/\s+/g, " ").trim();
  return flat.length > 34 ? `${flat.slice(0, 18)}…${flat.slice(-12)}` : flat;
};

export const eventsOfWorker = (events: StreamEvent[], worker: Worker): StreamEvent[] =>
  events.filter((event) => event.agent === worker.label || event.agent === worker.id);

export const commandsOf = (events: StreamEvent[], ended = false): Command[] => {
  const commands: Command[] = [];
  const pending = new Map<string, Command[]>();
  const byId = new Map<string, Command>();
  for (const event of events) {
    if (event.tool === undefined) continue;
    const at = Date.parse(event.at);
    if (event.kind === "tool_use") {
      const command: Command = {
        at,
        tool: event.tool,
        cmd: event.cmd ?? "",
        ms: null,
        status: "running",
        lane: laneOf(event.tool),
      };
      commands.push(command);
      if (event.toolUseId !== undefined) byId.set(event.toolUseId, command);
      else pending.set(event.tool, [...(pending.get(event.tool) ?? []), command]);
    } else if (event.kind === "tool_result" || event.kind === "tool_error") {
      const open =
        event.toolUseId !== undefined && byId.has(event.toolUseId)
          ? byId.get(event.toolUseId)
          : pending.get(event.tool)?.shift();
      const status: CommandStatus = event.ok === false ? "failed" : "ok";
      if (open) {
        open.ms = event.ms ?? at - open.at;
        open.status = status;
      } else {
        const ms = event.ms ?? 0;
        commands.push({ at: at - ms, tool: event.tool, cmd: "", ms, status, lane: laneOf(event.tool) });
      }
    }
  }
  if (!ended) return commands;
  return commands.map((command) => (command.status === "running" ? { ...command, status: "lost" } : command));
};

export const nowDoing = (events: StreamEvent[]): Command | undefined => {
  const commands = commandsOf(events);
  return commands.filter((command) => command.status === "running").pop() ?? commands.pop();
};

export const isMutating = (events: StreamEvent[]): boolean =>
  commandsOf(events).some((command) => command.status === "running" && command.tool.startsWith(MUTATION_PREFIX));
