import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { Size } from "./size.ts";
import { ORCH_TOOL_NAMES } from "./tools.ts";
import { LINEAR_TOOL_NAMES } from "./linear-tools.ts";
import { PLAYWRIGHT_TOOLS } from "./mcp-servers.ts";
import { SPIKE_TOOL_NAMES } from "./spike-tools.ts";
import { ALL_PG_TOOL_NAMES } from "./postgres-tools.ts";
import { forgeTools } from "./forge-server.ts";
import { MODELS, type Phase, type RoleName } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = path.join(here, "..", "prompts");

export type PromptVars = {
  AGENT: string;
  WORKFLOW: string;
  TICKET: string;
  WORKTREE: string;
  PACK: string;
  BASE: string;
  BRIEF: string;
};

const RECORDER_FLOWS = path.join(here, "..", "..", "recorder", "flows");

const fill = (template: string, vars: PromptVars): string => {
  const values: Record<string, string> = { ...vars, RECORDER_FLOWS };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? `{{${key}}}`);
};

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
  needsForge?: boolean;
  testFilesOnly?: boolean;
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
    effort: "high",
    maxTurns: 80,
  },
  builder: {
    role: "builder",
    model: MODELS.sonnet,
    phase: "build",
    description:
      "Implements exactly one brief, inside its scope boundary. Never commits and never runs the test suite.",
    tools: WRITE_TOOLS,
    writes: true,
    effort: "medium",
    maxTurns: 150,
  },
  fixer: {
    role: "fixer",
    phase: "static",
    model: MODELS.sonnet,
    description:
      "Runs yarn static and fixes only what this branch broke. Adds nothing, refactors nothing, suppresses nothing.",
    tools: WRITE_TOOLS,
    writes: true,
    effort: "low",
    maxTurns: 30,
  },
  tester: {
    role: "tester",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Writes and runs usecase-level integration tests against the brief, in every flag state, when no codex exists for the scope. Never fixes the implementation.",
    tools: [...WRITE_TOOLS, ...ALL_PG_TOOL_NAMES],
    writes: true,
    needsPostgres: true,
    testFilesOnly: true,
    effort: "medium",
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
    effort: "medium",
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
    effort: "high",
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
    effort: "medium",
    maxTurns: 120,
  },
  checker: {
    role: "checker",
    model: MODELS.sonnet,
    phase: "audit",
    description:
      "Re-derives every finding from the code without the surveyor's reasoning, and rejects whatever it cannot reproduce.",
    tools: [...AUDIT_TOOLS, ...SPIKE_TOOL_NAMES, ...ALL_PG_TOOL_NAMES],
    writes: false,
    needsPostgres: true,
    needsSpike: true,
    effort: "high",
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
    effort: "high",
    maxTurns: 100,
  },
  mapper: {
    role: "mapper",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Maps the changed production code: the unit contract, the coverage matrix, the effect closure and one test file per unit. Writes no test.",
    tools: [
      ...AUDIT_TOOLS,
      "Write",
      ...forgeTools(
        "ast_file_facts",
        "codex_rules_for",
        "codex_rule_get",
        "ledger_matrix_upsert",
        "closure_compute",
        "closure_unresolved",
        "closure_resolve_batch",
        "gates_status",
      ),
    ],
    writes: true,
    needsForge: true,
    effort: "medium",
    maxTurns: 80,
  },
  "test-author": {
    role: "test-author",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Owns one test file. Writes the tests for its matrix rows and focus lines, runs only that file, and marks the cells it covers. Never edits production code.",
    tools: [
      ...WRITE_TOOLS,
      ...forgeTools(
        "codex_rule_get",
        "codex_fixture_list",
        "ast_file_facts",
        "ledger_matrix_upsert",
        "ledger_verdict_record_batch",
      ),
    ],
    writes: true,
    needsForge: true,
    testFilesOnly: true,
    effort: "medium",
    maxTurns: 80,
  },
  inspector: {
    role: "inspector",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Judges one test file against each applicable codex rule, one verdict per rule, every answer anchored to a quoted line. Never sees the author's claims.",
    tools: [
      ...AUDIT_TOOLS,
      ...forgeTools(
        "codex_rule_get",
        "codex_fixture_list",
        "ast_check_batch",
        "ledger_verdict_record_batch",
        "ledger_finding_upsert_batch",
      ),
    ],
    writes: false,
    needsForge: true,
    effort: "medium",
    maxTurns: 40,
  },
  "defect-verifier": {
    role: "defect-verifier",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Rules on one red test: reproduces it alone, walks the execution path, derives the intent from the sources, and records one verdict.",
    tools: [
      ...READ_TOOLS,
      ...forgeTools(
        "ast_file_facts",
        "ledger_state",
        "ledger_finding_known",
        "ledger_finding_upsert",
        "ledger_verdict_record",
        "escalation_raise",
      ),
    ],
    writes: false,
    needsForge: true,
    effort: "medium",
    maxTurns: 60,
  },
  "defect-skeptic": {
    role: "defect-skeptic",
    model: MODELS.opus,
    phase: "test",
    description:
      "Attacks one confirmed defect: builds the strongest case that it is not a defect, and overturns the verdict when that case holds.",
    tools: [
      ...READ_TOOLS,
      ...forgeTools(
        "ledger_state",
        "ledger_finding_known",
        "ledger_finding_upsert",
        "ledger_overturn_record",
      ),
    ],
    writes: false,
    needsForge: true,
    effort: "high",
    maxTurns: 40,
  },
  "survivor-analyst": {
    role: "survivor-analyst",
    model: MODELS.sonnet,
    phase: "test",
    description:
      "Reads the surviving mutants of one production file and files an equivalence claim, or names the coverage hole a new test must close.",
    tools: [
      ...AUDIT_TOOLS,
      ...forgeTools("mutation_survivors", "mutation_equivalence_record", "ast_file_facts"),
    ],
    writes: false,
    needsForge: true,
    effort: "medium",
    maxTurns: 60,
  },
  "equivalence-hunter": {
    role: "equivalence-hunter",
    model: MODELS.opus,
    phase: "test",
    description:
      "Tries to refute each equivalence claim on one production file with a named observable difference and the input that produces it.",
    tools: [
      ...AUDIT_TOOLS,
      ...forgeTools("mutation_survivors", "mutation_equivalence_record", "ast_file_facts"),
    ],
    writes: false,
    needsForge: true,
    effort: "high",
    maxTurns: 60,
  },
};

export const agentLabel = (role: RoleName): string => `${role.toUpperCase()}-1`;

export const effortFor = (spec: RoleSpec, size?: Size): RoleSpec["effort"] =>
  spec.role === "reviewer" && size === "S" ? "medium" : spec.effort;

export const modelFor = (spec: RoleSpec, override?: string): string =>
  override ?? spec.model;

export const buildAgentDefinitions = (
  vars: PromptVars,
  roles: RoleName[],
  override?: string,
  size?: Size,
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
      effort: effortFor(spec, size),
      maxTurns: spec.maxTurns,
    };
  }
  return definitions;
};
