import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import pg from "pg";
import { isReadOnlySql } from "./hooks.ts";

export const PG_TENANTS = ["purco", "sdi"] as const;
export type PgTenant = (typeof PG_TENANTS)[number];

export const pgServerName = (tenant: PgTenant): string => `pg-${tenant}`;

const TOOLS = [
  "list_schemas",
  "list_tables",
  "describe_table",
  "read",
  "explain",
];

export const pgToolNames = (tenant: PgTenant): string[] =>
  TOOLS.map((name) => `mcp__${pgServerName(tenant)}__${name}`);

export const ALL_PG_TOOL_NAMES = PG_TENANTS.flatMap((tenant) =>
  pgToolNames(tenant),
);

const STATEMENT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_ROWS = 200;
const MAX_CELL_CHARS = 300;

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

const failure = (body: string) => ({ ...text(body), isError: true });

const scrubError = (message: string): string =>
  message
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`]+/g, "[uri]")
    .replace(/password=[^\s"'`&]+/gi, "password=[redacted]");

const renderRows = (
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string => {
  if (rows.length === 0) return "(0 rows)";
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (value instanceof Date) return value.toISOString();
    const asText =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    return asText.length > MAX_CELL_CHARS
      ? `${asText.slice(0, MAX_CELL_CHARS)}…`
      : asText;
  };
  const header = columns.join(" | ");
  const body = rows
    .map((row) => columns.map((column) => cell(row[column])).join(" | "))
    .join("\n");
  const note = rows.length >= MAX_ROWS ? `, truncated at ${MAX_ROWS}` : "";
  return `${header}\n${"-".repeat(Math.min(header.length, 120))}\n${body}\n(${rows.length} row${rows.length === 1 ? "" : "s"}${note})`;
};

export class ReadOnlyPostgres {
  private readonly pool: pg.Pool;
  readonly tenant: PgTenant;

  constructor(tenant: PgTenant, connectionString: string) {
    this.tenant = tenant;
    this.pool = new pg.Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 10_000,
      application_name: `purco-orchestrator-${tenant}`,
    });
    this.pool.on("error", () => undefined);
  }

  async read(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ output?: string; error?: string }> {
    if (!isReadOnlySql(sql)) {
      return {
        error:
          "Rejected: only a single read statement is allowed (SELECT, EXPLAIN, WITH ... SELECT, SHOW). Rewrite it, or escalate at level human if you believe a write is required.",
      };
    }
    let client: pg.PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      return {
        error: `Could not connect to the ${this.tenant} database: ${scrubError(String(error))}`,
      };
    }
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
      );
      const result = await client.query({ text: sql, values: params });
      const columns = result.fields.map((field) => field.name);
      const rows = (result.rows as Array<Record<string, unknown>>).slice(
        0,
        MAX_ROWS,
      );
      return { output: renderRows(columns, rows) };
    } catch (error) {
      return { error: `Query failed: ${scrubError(String(error))}` };
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch {
        void 0;
      }
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

export const buildPostgresServer = (db: ReadOnlyPostgres) => {
  const run = async (sql: string, params: unknown[] = []) => {
    const { output, error } = await db.read(sql, params);
    return error ? failure(error) : text(output ?? "(no output)");
  };

  return createSdkMcpServer({
    name: pgServerName(db.tenant),
    version: "0.1.0",
    instructions: `Read-only access to the ${db.tenant.toUpperCase()} database. Every statement runs inside a READ ONLY transaction that is always rolled back, with a ${STATEMENT_TIMEOUT_MS / 1000}s statement timeout, and at most ${MAX_ROWS} rows come back. Writes are impossible here; do not attempt one.`,
    tools: [
      tool(
        "list_schemas",
        `List the schemas in the ${db.tenant} database with their table counts.`,
        {},
        async () =>
          run(
            `select n.nspname as schema, count(c.oid) as tables
             from pg_namespace n
             left join pg_class c on c.relnamespace = n.oid and c.relkind = 'r'
             where n.nspname not in ('pg_catalog', 'information_schema')
               and n.nspname not like 'pg_toast%'
               and n.nspname not like 'pg_temp%'
             group by n.nspname
             order by n.nspname`,
          ),
      ),

      tool(
        "list_tables",
        `List tables and views in a schema of the ${db.tenant} database, with approximate row counts.`,
        { schema: z.string().optional() },
        async (args) =>
          run(
            `select c.relname as name,
                    case c.relkind
                      when 'r' then 'table'
                      when 'v' then 'view'
                      when 'm' then 'matview'
                      else c.relkind::text
                    end as kind,
                    c.reltuples::bigint as approx_rows
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = $1 and c.relkind in ('r', 'v', 'm')
             order by c.relname`,
            [args.schema ?? "public"],
          ),
      ),

      tool(
        "describe_table",
        `Describe one table in the ${db.tenant} database: columns, types, nullability, defaults, and its indexes.`,
        { table: z.string(), schema: z.string().optional() },
        async (args) => {
          const schema = args.schema ?? "public";
          const columns = await db.read(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = $1 and table_name = $2
             order by ordinal_position`,
            [schema, args.table],
          );
          if (columns.error) return failure(columns.error);
          const indexes = await db.read(
            `select indexname, indexdef
             from pg_indexes
             where schemaname = $1 and tablename = $2
             order by indexname`,
            [schema, args.table],
          );
          return text(
            [
              `# ${schema}.${args.table}`,
              "",
              "## Columns",
              columns.output ?? "(none)",
              "",
              "## Indexes",
              indexes.error
                ? `(unavailable: ${indexes.error})`
                : (indexes.output ?? "(none)"),
            ].join("\n"),
          );
        },
      ),

      tool(
        "read",
        `Run one read-only SQL statement against the ${db.tenant} database. SELECT, WITH ... SELECT, SHOW and EXPLAIN only. Add your own LIMIT; at most ${MAX_ROWS} rows are returned.`,
        { sql: z.string() },
        async (args) => run(args.sql),
      ),

      tool(
        "explain",
        `Show the query plan for a statement against the ${db.tenant} database. Uses EXPLAIN without ANALYZE, so the statement is not executed.`,
        { sql: z.string() },
        async (args) => {
          const cleaned = args.sql.trim().replace(/;+\s*$/, "");
          if (!isReadOnlySql(cleaned)) {
            return failure("Only a read statement can be explained here.");
          }
          return run(`EXPLAIN ${cleaned}`);
        },
      ),
    ],
  });
};
