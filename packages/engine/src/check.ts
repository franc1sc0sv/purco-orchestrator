import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import {
  buildLinearServer,
  hasLinearKey,
  linearKeySource,
  LINEAR_SERVER,
  LINEAR_TOOL_NAMES,
} from "./linear-tools.ts";
import { PLAYWRIGHT_SERVER, PLAYWRIGHT_TOOLS } from "./mcp-servers.ts";
import { openPools } from "./postgres-config.ts";
import { MCP_STARTUP_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS } from "./orchestrator.ts";

const PURCO_WEB_ROOT = path.join(
  process.env.HOME ?? "",
  "projects/purco-projects/purco-web",
);

const WRITE_PROBES = [
  "delete from claims",
  "update claims set settled_at = now()",
  "select 1; delete from claims",
  "with x as (delete from claims returning id) select * from x",
];

const ask = async (
  prompt: string,
  servers: Record<string, McpServerConfig>,
  allowedTools: string[],
  configDir: string,
): Promise<{ answer: string; cost: number }> => {
  let answer = "";
  let cost = 0;
  for await (const message of query({
    prompt,
    options: {
      model: "claude-sonnet-5-5",
      cwd: PURCO_WEB_ROOT,
      settingSources: [],
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: configDir,
        MCP_TIMEOUT: MCP_STARTUP_TIMEOUT_MS,
        MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS,
      },
      mcpServers: servers,
      allowedTools,
      permissionMode: "bypassPermissions",
      maxTurns: 8,
      effort: "low",
    },
  })) {
    if (message.type === "result") {
      cost = message.total_cost_usd ?? 0;
      answer =
        message.subtype === "success"
          ? message.result.trim()
          : `RESULT_${message.subtype}`;
    }
  }
  return { answer, cost };
};

export const checkMcp = async (
  ticket: string,
  configDir: string,
): Promise<number> => {
  let total = 0;
  let failures = 0;
  const line = (name: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    process.stdout.write(
      `${(ok ? "OK" : "FAIL").padEnd(6)} ${name.padEnd(14)} ${detail.replace(/\s+/g, " ").slice(0, 120)}\n`,
    );
  };

  process.stdout.write(`config dir  ${configDir}\n`);
  process.stdout.write(`project     ${PURCO_WEB_ROOT}\n`);
  process.stdout.write(`linear key  ${linearKeySource()}\n\n`);

  if (!hasLinearKey()) {
    process.stdout.write(
      `SKIP   linear         no key in environment or keychain; run: security add-generic-password -a "$USER" -s LINEAR_API_KEY -w\n`,
    );
  } else {
    const { answer, cost } = await ask(
      `Call get_issue for ${ticket}. Reply with only its title, or FAILED and the reason.`,
      { [LINEAR_SERVER]: buildLinearServer() },
      LINEAR_TOOL_NAMES,
      configDir,
    );
    total += cost;
    line("linear", !answer.includes("FAILED"), answer);
  }

  {
    const { answer, cost } = await ask(
      "Call browser_navigate to https://example.com then browser_snapshot. Reply with only the page title, or FAILED and the reason. Then call browser_close.",
      { playwright: PLAYWRIGHT_SERVER },
      PLAYWRIGHT_TOOLS,
      configDir,
    );
    total += cost;
    line("playwright", !answer.includes("FAILED"), answer);
  }

  const { pools, notes } = await openPools(PURCO_WEB_ROOT);
  process.stdout.write("\n");
  for (const note of notes) process.stdout.write(`  postgres ${note}\n`);

  if (pools.size === 0) {
    line("postgres", false, "no connection strings resolved from .mcp.json");
  } else {
    for (const [tenant, db] of pools) {
      const started = Date.now();
      const probe = await db.read(
        "select current_database() as db, current_user as usr",
      );
      const ms = Date.now() - started;
      line(
        `pg-${tenant}`,
        probe.error === undefined,
        probe.error ?? `${probe.output?.split("\n")[2] ?? ""} (${ms}ms)`,
      );

      const blocked = await Promise.all(
        WRITE_PROBES.map(
          async (sql) => (await db.read(sql)).error !== undefined,
        ),
      );
      line(
        `pg-${tenant} guard`,
        blocked.every(Boolean),
        `${blocked.filter(Boolean).length}/${blocked.length} write attempts rejected`,
      );

      const readOnly = await db.read("show transaction_read_only");
      line(
        `pg-${tenant} txn`,
        readOnly.output?.includes("on") === true,
        readOnly.output?.split("\n")[2] ?? readOnly.error ?? "unknown",
      );

      await db.close();
    }
  }

  process.stdout.write(
    `\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`} · check cost $${total.toFixed(4)}\n`,
  );
  return failures === 0 ? 0 : 1;
};
