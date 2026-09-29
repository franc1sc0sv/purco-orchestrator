import { SERVER_NAME, SERVER_VERSION } from "./constants.ts";
import { registerAllTools } from "./mcp/registry.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const log = (message: string): void => {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
};

const start = async (): Promise<void> => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const registered = registerAllTools(server);
  await server.connect(new StdioServerTransport());
  log(
    `version ${SERVER_VERSION} listening on stdio with ${registered.length} tools`
  );
};

start().catch((error: unknown) => {
  log(
    `startup failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
