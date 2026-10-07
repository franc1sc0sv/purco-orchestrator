import { SERVER_NAME } from "./tools.ts";

export type InitSnapshot = {
  mcp_servers: ReadonlyArray<{ name: string; status: string }>;
  tools: ReadonlyArray<string>;
};

export const REQUIRED_ORCH_TOOL = `mcp__${SERVER_NAME}__handoff`;

export const orchestratorToolsProblem = (init: InitSnapshot): string | undefined => {
  const server = init.mcp_servers.find((entry) => entry.name === SERVER_NAME);
  if (!server) return "not registered";
  if (server.status !== "connected") return server.status;
  if (!init.tools.includes(REQUIRED_ORCH_TOOL)) return "connected but no handoff tool";
  return undefined;
};
