import { AGENTS_PATH, MCP_TOOL_PREFIX, RESOURCES_PATH } from "./install.ts";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const BUILT_IN_TOOLS: ReadonlySet<string> = new Set([
  "Agent",
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "Skill",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
]);

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type Effort = (typeof EFFORTS)[number];

const isEffort = (value: string): value is Effort =>
  EFFORTS.includes(value as Effort);

export const MODEL_IDS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;

export type ModelAlias = keyof typeof MODEL_IDS;

const isModelAlias = (value: string): value is ModelAlias =>
  Object.hasOwn(MODEL_IDS, value);

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const OBJECTIVE =
  /^##\s+Your objective\s*\r?\n+([\s\S]*?)(?=\r?\n#{1,2}\s|\s*$)/m;
const DESCRIPTION_LIMIT = 600;

export const AGENT_PROTOCOL_PATH = join(
  RESOURCES_PATH,
  "doctrine",
  "agent-protocol.md"
);

export type Brief = {
  path: string;
  file: string;
  squad: string;
  post: string;
  tag: string;
  callsigns: string[];
  tools: string[];
  effort: Effort | null;
  model: string | null;
  body: string;
};

export type ParsedBrief = {
  data: Record<string, string>;
  body: string;
};

export type AgentMap = Record<string, AgentDefinition>;

export type BuildAgentsOptions = {
  root?: string;
  includeCommand?: boolean;
};

const unquote = (value: string): string =>
  value.replace(/^["']/, "").replace(/["']$/, "").trim();

export const parseFrontmatter = (text: string): ParsedBrief => {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { data: {}, body: text.trim() };

  const data: Record<string, string> = {};
  for (const entry of (match[1] ?? "").split(/\r?\n/)) {
    const separator = entry.indexOf(":");
    if (separator === -1) continue;
    const key = entry.slice(0, separator).trim();
    if (key.length === 0 || key.startsWith("#")) continue;
    data[key] = unquote(entry.slice(separator + 1));
  }
  return { data, body: text.slice(match[0].length).trim() };
};

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isPlaceholder = (value: string): boolean =>
  value.length === 0 || /[<>]|\.\.\.|…/.test(value);

const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const stripQualifier = (value: string): string =>
  value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const familyName = (callsign: string): string =>
  callsign.split(/\s+/).pop() ?? callsign;

const qualifyTool = (name: string): string =>
  BUILT_IN_TOOLS.has(name) ? name : `${MCP_TOOL_PREFIX}${name}`;

const firstParagraph = (text: string): string =>
  (text.split(/\r?\n\s*\r?\n/)[0] ?? "").replace(/\s+/g, " ").trim();

const clamp = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;

const describe = (brief: Brief): string => {
  const heading = [brief.squad, brief.post].filter(Boolean).join(" — ");
  const objective = OBJECTIVE.exec(brief.body);
  const detail =
    objective === null
      ? `Callsigns: ${brief.callsigns.join(", ")}.`
      : firstParagraph(objective[1] ?? "");
  return clamp(`${heading}. ${detail}`, DESCRIPTION_LIMIT);
};

const markdownFiles = (root: string): string[] => {
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && extname(entry.name) === ".md") found.push(full);
    }
  };

  walk(root);
  return found.sort();
};

export const readBrief = (path: string): Brief => {
  const { data, body } = parseFrontmatter(readFileSync(path, "utf8"));
  const file = basename(path, ".md");
  const callsigns = splitList(data["callsign"])
    .map(stripQualifier)
    .filter((entry) => !isPlaceholder(entry));
  const effort = (data["effort"] ?? "").toLowerCase();
  const model = (data["model"] ?? "").toLowerCase();

  return {
    path,
    file,
    squad: data["squad"] ?? "",
    post: data["post"] ?? file,
    tag: data["tag"] ?? "",
    callsigns,
    tools: splitList(data["tools"]),
    effort: isEffort(effort) ? effort : null,
    model: isModelAlias(model) ? MODEL_IDS[model] : null,
    body,
  };
};

export const readBriefs = (root: string = AGENTS_PATH): Brief[] =>
  markdownFiles(root).map(readBrief);

export const findBrief = (
  name: string,
  briefs: readonly Brief[] = readBriefs()
): Brief => {
  const wanted = slug(name);
  const brief = briefs.find(
    (entry) =>
      slug(entry.file) === wanted ||
      entry.callsigns.some((callsign) => slug(callsign) === wanted)
  );
  if (brief === undefined) {
    throw new Error(`No brief matches "${name}" under ${AGENTS_PATH}`);
  }
  return brief;
};

export const buildAgents = ({
  root = AGENTS_PATH,
  includeCommand = false,
}: BuildAgentsOptions = {}): AgentMap => {
  const agents: AgentMap = {};
  const protocol = readFileSync(AGENT_PROTOCOL_PATH, "utf8").trim();

  for (const brief of readBriefs(root)) {
    if (!includeCommand && slug(brief.squad) === "command") continue;

    const definition: AgentDefinition = {
      description: describe(brief),
      prompt: `${brief.body}\n\n---\n\n${protocol}`,
      tools: brief.tools.map(qualifyTool),
      ...(brief.effort === null ? {} : { effort: brief.effort }),
      ...(brief.model === null ? {} : { model: brief.model }),
    };

    const keys = [
      ...brief.callsigns.map(slug),
      ...brief.callsigns.map((callsign) => slug(familyName(callsign))),
      slug(brief.file),
    ];
    for (const key of keys) {
      if (key.length === 0 || agents[key] !== undefined) continue;
      agents[key] = definition;
    }
  }

  return agents;
};
