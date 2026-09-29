import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { ORCH_TOOL_NAMES } from "./tools.ts";
import { LINEAR_TOOL_NAMES } from "./linear-tools.ts";
import { PLAYWRIGHT_TOOLS } from "./mcp-servers.ts";
import { SPIKE_TOOL_NAMES } from "./spike-tools.ts";
import { ALL_PG_TOOL_NAMES } from "./postgres-tools.ts";
import { MODELS, type Phase, type RoleName } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(here, "..", "prompts");

export type PromptVars = {
  AGENT: string;
  TICKET: string;
  WORKTREE: string;
  PACK: string;
  BASE: string;
  BRIEF: string;
};

const fill = (template: string, vars: PromptVars): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? vars[key as keyof PromptVars] : `{{${key}}}`,
  );

export const loadPrompt = (name: string, vars: PromptVars): string => {
  const body = fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), "utf8");
  return fill(body, vars);
};

export const rolePrompt = (role: RoleName, vars: PromptVars): string => {
  const protocol = loadPrompt("_protocol", vars);
  const body = loadPrompt(role, vars);
  return `${body}\n\n---\n\n${protocol}`;
};

const READ_TOOLS = ["Read", "Grep", "Glob", "Bash", "TodoWrite"];
const WRITE_TOOLS = [...READ_TOOLS, "Write", "Edit", "NotebookEdit"];
const AUDIT_TOOLS = ["Read", "Grep", "Glob", "TodoWrite"];

export type RoleSpec = {
  role: RoleName;
  phase: Phase;
  description: string;
  model: string;
  tools: string[];
  writes: boolean;
  needsBrowser?: boolean;
  needsLinear?: boolean;
  needsPostgres?: boolean;
  needsSpike?: boolean;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns: number;
};

export const ROLE_SPECS: Record<RoleName, RoleSpec> = {
  intake: {
    role: "intake",
    model: MODELS.sonnet,
    phase: "intake",
    description:
      "Reads the seeded ticket, the context pack, the open PRs and the current code state. Reports facts only; never plans.",
    tools: [...READ_TOOLS, "Write", ...LINEAR_TOOL_NAMES],
    writes: true,
    needsLinear: true,
    effort: "medium",
    maxTurns: 60,
  },
  inquisitor: {
    role: "inquisitor",
    model: MODELS.sonnet,
    phase: "grill",
    description:
      "Finds every decision the ticket leaves open and frames each one for the human. Looks up every fact itself and asks nothing.",
    tools: [...READ_TOOLS, "Write", ...LINEAR_TOOL_NAMES, ...ALL_PG_TOOL_NAMES],
    writes: true,
    needsLinear: true,
    needsPostgres: true,
    effort: "high",
    maxTurns: 60,
  },
  planner: {
    role: "planner",
    model: MODELS.opus,
    phase: "plan",
    description:
      "Decides the approach and splits it into buildable briefs. Asks the orchestrator on every contested decision.",
    tools: [...READ_TOOLS, "Write", ...LINEAR_TOOL_NAMES, ...ALL_PG_TOOL_NAMES],
    writes: true,
    needsLinear: true,
    needsPostgres: true,
    effort: "xhigh",
    maxTurns: 80,
  },
  builder: {
    role: "builder",
    model: MODELS.opus,
    phase: "build",
    description:
      "Implements exactly one brief, inside its scope boundary. Never commits and never runs the test suite.",
    tools: WRITE_TOOLS,
    writes: true,
    effort: "xhigh",
    maxTurns: 150,
  },
  fixer: {
    role: "fixer",
    phase: "static",
    model: MODELS.haiku,
    description:
      "Runs yarn static and fixes only what this branch broke. Adds nothing, refactors nothing, suppresses nothing.",
    tools: WRITE_TOOLS,
    writes: true,
    effort: "low",
    maxTurns: 30,
  },
  tester: {
    role: "tester",
    model: MODELS.opus,
    phase: "test",
    description:
      "Writes and runs usecase-level integration tests against the brief, in every flag state. Never fixes the implementation.",
    tools: [...WRITE_TOOLS, ...ALL_PG_TOOL_NAMES],
    writes: true,
    needsPostgres: true,
    effort: "xhigh",
    maxTurns: 150,
  },
  verifier: {
    role: "verifier",
    model: MODELS.sonnet,
    phase: "verify",
    description:
      "Drives the live application through Playwright and reports what a user would see. Changes nothing but its report.",
    tools: [...READ_TOOLS, ...PLAYWRIGHT_TOOLS, "Write"],
    writes: true,
    needsBrowser: true,
    effort: "high",
    maxTurns: 100,
  },
  reviewer: {
    role: "reviewer",
    model: MODELS.opus,
    phase: "review",
    description:
      "Reviews the diff against the plan, the ADRs and the repository rules. Traces the full data flow before flagging anything serious.",
    tools: [...READ_TOOLS, "Write", ...ALL_PG_TOOL_NAMES],
    writes: true,
    needsPostgres: true,
    effort: "xhigh",
    maxTurns: 100,
  },
  surveyor: {
    role: "surveyor",
    model: MODELS.sonnet,
    phase: "survey",
    description:
      "Judges one cluster of censused sites. Reads code only, records a finding per leftover and a triage per site. Cannot write files and cannot look for work outside its worklist.",
    tools: [...AUDIT_TOOLS, ...SPIKE_TOOL_NAMES],
    writes: false,
    needsSpike: true,
    effort: "xhigh",
    maxTurns: 120,
  },
  checker: {
    role: "checker",
    model: MODELS.opus,
    phase: "audit",
    description:
      "Re-derives every finding from the code without the surveyor's reasoning, and rejects whatever it cannot reproduce.",
    tools: [...AUDIT_TOOLS, ...SPIKE_TOOL_NAMES, ...ALL_PG_TOOL_NAMES],
    writes: false,
    needsPostgres: true,
    needsSpike: true,
    effort: "xhigh",
    maxTurns: 120,
  },
  synthesist: {
    role: "synthesist",
    model: MODELS.sonnet,
    phase: "synthesize",
    description:
      "Reads the verified findings and writes the inventory, the write-path report, the removal order and the ADR. Looks across clusters for patterns judged inconsistently.",
    tools: [...AUDIT_TOOLS, "Write", ...SPIKE_TOOL_NAMES],
    writes: true,
    needsSpike: true,
    effort: "xhigh",
    maxTurns: 100,
  },
};

export const agentLabel = (role: RoleName): string => `${role.toUpperCase()}-1`;

export const modelFor = (spec: RoleSpec, override?: string): string =>
  override ?? spec.model;

export const buildAgentDefinitions = (
  vars: PromptVars,
  roles: RoleName[],
  override?: string,
): Record<string, AgentDefinition> => {
  const definitions: Record<string, AgentDefinition> = {};
  for (const role of roles) {
    const spec = ROLE_SPECS[role];
    definitions[spec.role] = {
      description: spec.description,
      prompt: rolePrompt(spec.role, {
        ...vars,
        AGENT: agentLabel(spec.role),
      }),
      tools: [...spec.tools, ...ORCH_TOOL_NAMES],
      model: modelFor(spec, override),
      effort: spec.effort,
      maxTurns: spec.maxTurns,
    };
  }
  return definitions;
};
