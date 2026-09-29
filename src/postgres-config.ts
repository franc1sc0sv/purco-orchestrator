import fs from "node:fs";
import path from "node:path";
import { expandPlaceholders } from "./mcp-servers.ts";
import {
  PG_TENANTS,
  ReadOnlyPostgres,
  type PgTenant,
} from "./postgres-tools.ts";

const SOURCE_SERVER: Record<PgTenant, string> = {
  purco: "postgres-purco",
  sdi: "postgres-sdi",
};

type RawEntry = { env?: Record<string, string> };

const readConfigured = (
  projectRoot: string
): { raw: Partial<Record<PgTenant, string>>; notes: string[] } => {
  const raw: Partial<Record<PgTenant, string>> = {};
  const notes: string[] = [];
  const configPath = path.join(projectRoot, ".mcp.json");

  if (!fs.existsSync(configPath)) {
    notes.push(`no .mcp.json at ${configPath}`);
    return { raw, notes };
  }

  let parsed: { mcpServers?: Record<string, RawEntry> };
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as typeof parsed;
  } catch (error) {
    notes.push(`could not parse .mcp.json: ${String(error)}`);
    return { raw, notes };
  }

  for (const tenant of PG_TENANTS) {
    const value = parsed.mcpServers?.[SOURCE_SERVER[tenant]]?.env?.DATABASE_URI;
    if (typeof value !== "string" || value.length === 0) {
      notes.push(`${tenant}: no DATABASE_URI in ${SOURCE_SERVER[tenant]}`);
      continue;
    }
    const expanded = expandPlaceholders(value, (name) => process.env[name]);
    if (expanded.length === 0) {
      notes.push(`${tenant}: DATABASE_URI expanded to an empty string`);
      continue;
    }
    raw[tenant] = expanded;
  }
  return { raw, notes };
};

const withDatabase = (uri: string, database: string): string | undefined => {
  try {
    const url = new URL(uri);
    url.pathname = `/${database}`;
    return url.toString();
  } catch {
    return undefined;
  }
};

const databaseOf = (uri: string): string => {
  try {
    return new URL(uri).pathname.replace(/^\//, "") || "(none)";
  } catch {
    return "(unparsed)";
  }
};

const hostOf = (uri: string): string => {
  try {
    return new URL(uri).hostname;
  } catch {
    return "(unparsed)";
  }
};

const probe = async (
  tenant: PgTenant,
  uri: string
): Promise<string | undefined> => {
  const db = new ReadOnlyPostgres(tenant, uri);
  const result = await db.read("select 1 as ok");
  await db.close();
  return result.error;
};

type Candidate = { uri: string; label: string };

const candidatesFor = (
  tenant: PgTenant,
  raw: Partial<Record<PgTenant, string>>
): Candidate[] => {
  const list: Candidate[] = [];
  const configured = raw[tenant];
  const override = process.env[`ORCH_PG_DB_${tenant.toUpperCase()}`];

  if (configured && override) {
    const swapped = withDatabase(configured, override);
    if (swapped)
      list.push({ uri: swapped, label: `database override "${override}"` });
  }
  if (configured) {
    list.push({ uri: configured, label: "as configured in .mcp.json" });
    const byTenant = withDatabase(configured, tenant);
    if (byTenant && byTenant !== configured) {
      list.push({ uri: byTenant, label: `database corrected to "${tenant}"` });
    }
  }
  for (const other of PG_TENANTS) {
    if (other === tenant) continue;
    const donor = raw[other];
    if (!donor) continue;
    const borrowed = withDatabase(donor, override ?? tenant);
    if (borrowed) {
      list.push({
        uri: borrowed,
        label: `credentials borrowed from ${other}, database "${
          override ?? tenant
        }"`,
      });
    }
  }
  return list;
};

export const resolveConnections = async (
  projectRoot: string
): Promise<{ uris: Partial<Record<PgTenant, string>>; notes: string[] }> => {
  const { raw, notes } = readConfigured(projectRoot);
  const uris: Partial<Record<PgTenant, string>> = {};

  for (const tenant of PG_TENANTS) {
    const candidates = candidatesFor(tenant, raw);
    if (candidates.length === 0) {
      notes.push(`${tenant}: no connection string to try`);
      continue;
    }
    let lastError = "unknown";
    let connected = false;
    for (const candidate of candidates) {
      const error = await probe(tenant, candidate.uri);
      if (error === undefined) {
        uris[tenant] = candidate.uri;
        notes.push(
          `${tenant}: connected to ${hostOf(candidate.uri)}/${databaseOf(
            candidate.uri
          )} — ${candidate.label}`
        );
        connected = true;
        break;
      }
      lastError = error;
    }
    if (!connected) {
      notes.push(
        `${tenant}: every candidate failed (${candidates.length} tried). Last error: ${lastError}`
      );
    }
  }

  return { uris, notes };
};

export const openPools = async (
  projectRoot: string
): Promise<{ pools: Map<PgTenant, ReadOnlyPostgres>; notes: string[] }> => {
  const { uris, notes } = await resolveConnections(projectRoot);
  const pools = new Map<PgTenant, ReadOnlyPostgres>();
  for (const tenant of PG_TENANTS) {
    const uri = uris[tenant];
    if (uri) pools.set(tenant, new ReadOnlyPostgres(tenant, uri));
  }
  return { pools, notes };
};
