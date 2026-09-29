import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

const MIGRATIONS_PATH = join(import.meta.dirname, "migrations");

const FILE_NAME = /^\d{4}-[a-z0-9-]+\.sql$/;

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`;

type Migration = {
  version: number;
  name: string;
  sql: string;
};

type VersionRow = { value: string };

export const schemaVersion = (db: DatabaseSync): number => {
  const row: unknown = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get();
  if (row === undefined || row === null) return 0;
  const parsed = Number.parseInt((row as VersionRow).value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const toMigration = (directory: string, file: string): Migration => {
  if (!FILE_NAME.test(file)) {
    throw new Error(`migration file must be named <nnnn>-<slug>.sql: ${file}`);
  }
  return {
    version: Number.parseInt(file, 10),
    name: file,
    sql: readFileSync(join(directory, file), "utf8"),
  };
};

const assertUniqueVersions = (migrations: readonly Migration[]): void => {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }
};

const pendingMigrations = (directory: string, from: number): Migration[] => {
  if (!existsSync(directory)) return [];
  const migrations = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => toMigration(directory, file))
    .sort((left, right) => left.version - right.version);
  assertUniqueVersions(migrations);
  return migrations.filter((migration) => migration.version > from);
};

const apply = (db: DatabaseSync, migration: Migration): void => {
  db.exec("BEGIN");
  try {
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
    ).run(migration.version, migration.name);
    db.prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run(String(migration.version));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`migration ${migration.name} failed`, { cause: error });
  }
};

export const applyMigrations = (
  db: DatabaseSync,
  directory: string = MIGRATIONS_PATH,
): number => {
  db.exec(MIGRATIONS_TABLE);
  const pending = pendingMigrations(directory, schemaVersion(db));
  if (pending.length === 0) return schemaVersion(db);
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const migration of pending) apply(db, migration);
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return schemaVersion(db);
};
