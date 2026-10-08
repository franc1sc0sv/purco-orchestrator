import { SERVER_NAME, SERVER_VERSION } from "../constants.ts";
import { registerAnalysisTools } from "./tools/analysis.tools.ts";
import { registerCampaignTools } from "./tools/campaign.tools.ts";
import { registerClosureTools } from "./tools/closure.tools.ts";
import { registerCodexTools } from "./tools/codex.tools.ts";
import { registerEscalationTools } from "./tools/escalation.tools.ts";
import { registerExecutionTools } from "./tools/execution.tools.ts";
import { registerGatesTools } from "./tools/gates.tools.ts";
import { registerLedgerTools } from "./tools/ledger.tools.ts";
import { registerMutationTools } from "./tools/mutation.tools.ts";
import { registerStrykerTools } from "./tools/stryker.tools.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_NAMES } from "test-forge-contracts/tool-names";

export type RegisterTools = (server: McpServer) => void;

const REGISTRARS: readonly RegisterTools[] = [
  registerAnalysisTools,
  registerCampaignTools,
  registerClosureTools,
  registerCodexTools,
  registerEscalationTools,
  registerExecutionTools,
  registerGatesTools,
  registerLedgerTools,
  registerMutationTools,
  registerStrykerTools,
];

type RegisterTool = McpServer["registerTool"];

const recordingServer = (
  server: McpServer,
  record: (name: string) => void
): McpServer => {
  const registerTool: RegisterTool = (name, config, handler) => {
    record(name);
    return server.registerTool(name, config, handler);
  };
  return new Proxy(server, {
    get: (target, property, receiver) =>
      property === "registerTool"
        ? registerTool
        : Reflect.get(target, property, receiver),
  });
};

const runRegistrars = (server: McpServer): readonly string[] => {
  const registered: string[] = [];
  const seen = new Set<string>();
  const recorder = recordingServer(server, (name) => {
    if (seen.has(name)) {
      throw new Error(
        `Tool "${name}" is registered twice. Every tool name must be registered by exactly one register function.`
      );
    }
    seen.add(name);
    registered.push(name);
  });
  for (const register of REGISTRARS) {
    register(recorder);
  }
  return registered;
};

const assertMatchesContract = (registered: readonly string[]): void => {
  const declared = new Set<string>(TOOL_NAMES);
  const present = new Set(registered);
  const missing = TOOL_NAMES.filter((name) => !present.has(name));
  const unexpected = registered.filter((name) => !declared.has(name));
  if (missing.length === 0 && unexpected.length === 0) {
    return;
  }
  throw new Error(
    [
      `The registered tools do not match TOOL_NAMES (${TOOL_NAMES.length} declared, ${registered.length} registered).`,
      `Declared but not registered: ${
        missing.length === 0 ? "none" : missing.join(", ")
      }.`,
      `Registered but not declared: ${
        unexpected.length === 0 ? "none" : unexpected.join(", ")
      }.`,
      "Add the missing register calls, or update TOOL_NAMES in the contracts package.",
    ].join(" ")
  );
};

export const registerAllTools = (server: McpServer): readonly string[] => {
  const registered = runRegistrars(server);
  assertMatchesContract(registered);
  return registered;
};

export const listRegisteredToolNames = (): readonly string[] =>
  [
    ...runRegistrars(
      new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
    ),
  ].sort();
