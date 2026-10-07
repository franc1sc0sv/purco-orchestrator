import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));

export const FORGE_ROOT = path.resolve(here, "..", "..", "test-forge");

export const FORGE_SERVER_NAME = "test-forge";

export const FORGE_SERVER: McpServerConfig = {
  type: "stdio",
  command: process.execPath,
  args: [path.join(FORGE_ROOT, "packages", "mcp", "src", "server.ts")],
};

export const forgeTools = (...names: string[]): string[] =>
  names.map((name) => `mcp__${FORGE_SERVER_NAME}__${name}`);
