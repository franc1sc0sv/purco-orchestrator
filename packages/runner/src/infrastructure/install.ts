import { join, resolve } from "node:path";

export const TESTING_ROOT = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".."
);

export const RESOURCES_PATH = join(TESTING_ROOT, "resources");

export const AGENTS_PATH = join(RESOURCES_PATH, "agents");

export const DATA_PATH = join(TESTING_ROOT, "data");

export const SESSIONS_FILE = join(DATA_PATH, "sessions.json");

export const MCP_SERVER_PATH = join(
  TESTING_ROOT,
  "packages",
  "mcp",
  "src",
  "server.ts"
);

export const MCP_SERVER_KEY = "test-forge";

export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_KEY}__`;

export const ENTRY_COMMAND = "node packages/runner/src/main.ts";
