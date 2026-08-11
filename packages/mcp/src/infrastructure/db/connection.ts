import { DB_PATH } from "../../constants.ts";
import { applyMigrations } from "./migrations.ts";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlValue = null | number | bigint | string | Uint8Array;

export type ChangeSummary = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};

export type TxScope = {
  readonly db: DatabaseSync;
  readonly depth: number;
};

const SCHEMA_PATH = join(import.meta.dirname, "schema.sql");

let handle: DatabaseSync | null = null;

const baselineIsApplied = (db: DatabaseSync): boolean => {
  const found: unknown = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
    )
    .get();
  return Boolean(found);
};

export const openDb = (): DatabaseSync => {
  if (handle) return handle;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  if (!baselineIsApplied(db)) db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  applyMigrations(db);
  handle = db;
  return handle;
};

export const closeDb = (): void => {
  if (!handle) return;
  handle.close();
  handle = null;
};

const nestedScope = (target: DatabaseSync | TxScope): TxScope =>
  "db" in target
    ? { db: target.db, depth: target.depth + 1 }
    : { db: target, depth: 0 };

export const tx = <TResult>(
  target: DatabaseSync | TxScope,
  fn: (txScope: TxScope) => TResult,
): TResult => {
  const txScope = nestedScope(target);
  const savepoint = `forge_sp_${txScope.depth}`;
  txScope.db.exec(txScope.depth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
  try {
    const result = fn(txScope);
    txScope.db.exec(txScope.depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    txScope.db.exec(
      txScope.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}`,
    );
    throw error;
  }
};

export const bindable = (value: unknown): SqlValue => {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string"
  ) {
    return value;
  }
  throw new TypeError(`cannot bind a ${typeof value} to SQLite`);
};

const bindAll = (params: readonly unknown[]): SqlValue[] =>
  params.map(bindable);

export const all = <TRow>(
  db: DatabaseSync,
  sql: string,
  params: readonly unknown[] = [],
): TRow[] => {
  const rows: unknown = db.prepare(sql).all(...bindAll(params));
  return rows as TRow[];
};

export const one = <TRow>(
  db: DatabaseSync,
  sql: string,
  params: readonly unknown[] = [],
): TRow | null => {
  const row: unknown = db.prepare(sql).get(...bindAll(params));
  return row === undefined || row === null ? null : (row as TRow);
};

export const run = (
  db: DatabaseSync,
  sql: string,
  params: readonly unknown[] = [],
): ChangeSummary => db.prepare(sql).run(...bindAll(params));

export const nowIso = (): string => new Date().toISOString();
