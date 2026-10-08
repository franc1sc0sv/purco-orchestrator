import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import type { ChangeSnapshot, ChangedFile, ChangedTable, Story, TicketKind } from "./types.ts";

const BASE_REF = "origin/dev";

export const LAYERS = ["Client", "API", "Domain", "Data", "Tests"] as const;
export type LayerName = (typeof LAYERS)[number];

const FLOW_LAYERS: readonly LayerName[] = ["Client", "API", "Domain", "Data"];

export type StoryLayer = { layer: LayerName; added: number; deleted: number; files: ChangedFile[] };

export type StoryEdge = { from: string; to: string; label?: string };

export type StoryView = {
  kind?: TicketKind;
  story?: Story;
  layers: StoryLayer[];
  edges: StoryEdge[];
  tables: ChangedTable[];
};

const git = (worktree: string, args: string[]): string[] => {
  try {
    return execFileSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
};

const lineCount = (file: string): number => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").length;
  } catch {
    return 0;
  }
};

const TEST_DIRECTORY = new RegExp("(^|/)tests?/");
const TEST_FILE = new RegExp("\\.(test|spec)\\.[tj]sx?$");
const CLIENT_PATH = new RegExp("^src/(pages|client)/");
const API_PATH = new RegExp("^src/server/api/.*router", "i");
const DATA_PATH = new RegExp("(repository|quer(y|ies)|kysely|prisma)", "i");
const DOMAIN_PATH = new RegExp("(usecase|service)", "i");

export const layerOf = (file: string): LayerName | undefined => {
  if (TEST_DIRECTORY.test(file) || TEST_FILE.test(file)) return "Tests";
  if (CLIENT_PATH.test(file)) return "Client";
  if (API_PATH.test(file)) return "API";
  if (DATA_PATH.test(file)) return "Data";
  if (DOMAIN_PATH.test(file)) return "Domain";
  return undefined;
};

const identifier = '(?:"?\\w+"?\\.)?"?(\\w+)"?';
const CREATE_TABLE = new RegExp(
  `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${identifier}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
  "gi",
);
const ALTER_TABLE = new RegExp(`alter\\s+table\\s+(?:only\\s+)?${identifier}\\s+([\\s\\S]*?);`, "gi");
const ADD_COLUMN = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
const REFERENCES = new RegExp(`references\\s+${identifier}`, "gi");
const CONSTRAINT_LINE = /^\s*(constraint|primary|unique|foreign|check|exclude)\b/i;
const COLUMN_LINE = /^\s*"?(\w+)"?\s+\w+/;

const matches = (pattern: RegExp, text: string): RegExpMatchArray[] => [...text.matchAll(pattern)];

const referencesIn = (text: string): string[] => matches(REFERENCES, text).map((match) => match[1] ?? "");

const columnsOfCreate = (body: string): string[] =>
  body
    .split("\n")
    .filter((line) => !CONSTRAINT_LINE.test(line))
    .map((line) => COLUMN_LINE.exec(line)?.[1] ?? "")
    .filter((name) => name.length > 0);

export const tablesOfMigration = (sql: string, migration: string): ChangedTable[] => {
  const created = matches(CREATE_TABLE, sql).map(
    (match): ChangedTable => ({
      name: match[1] ?? "",
      isNew: true,
      columns: columnsOfCreate(match[2] ?? ""),
      references: referencesIn(match[2] ?? ""),
      migration,
    }),
  );
  const altered = matches(ALTER_TABLE, sql).map(
    (match): ChangedTable => ({
      name: match[1] ?? "",
      isNew: false,
      columns: matches(ADD_COLUMN, match[2] ?? "").map((column) => column[1] ?? ""),
      references: referencesIn(match[2] ?? ""),
      migration,
    }),
  );
  return [...created, ...altered].filter((table) => table.name.length > 0);
};

const mergeTables = (tables: ChangedTable[]): ChangedTable[] => {
  const byName = new Map<string, ChangedTable>();
  for (const table of tables) {
    const held = byName.get(table.name);
    byName.set(
      table.name,
      held
        ? {
            ...held,
            isNew: held.isNew || table.isNew,
            columns: [...new Set([...held.columns, ...table.columns])],
            references: [...new Set([...held.references, ...table.references])],
          }
        : table,
    );
  }
  return [...byName.values()];
};

const isMigration = (file: string): boolean => /migration/i.test(file) && file.endsWith(".sql");

export const snapshotOf = (worktree: string): ChangeSnapshot => {
  const added = new Set(git(worktree, ["diff", "--name-only", "--diff-filter=A", BASE_REF]));
  const tracked = git(worktree, ["diff", "--numstat", BASE_REF]).flatMap((line): ChangedFile[] => {
    const [plus, minus, file] = line.split("\t");
    if (!file) return [];
    return [{ path: file, added: Number(plus) || 0, deleted: Number(minus) || 0, isNew: added.has(file) }];
  });
  const fresh = git(worktree, ["ls-files", "--others", "--exclude-standard"]).map(
    (file): ChangedFile => ({
      path: file,
      added: lineCount(path.join(worktree, file)),
      deleted: 0,
      isNew: true,
    }),
  );
  const files = [...tracked, ...fresh];
  const tables = mergeTables(
    files
      .filter((file) => isMigration(file.path))
      .flatMap((file) => {
        try {
          return tablesOfMigration(fs.readFileSync(path.join(worktree, file.path), "utf8"), file.path);
        } catch {
          return [];
        }
      }),
  );
  return { files, tables };
};

const nameOf = (file: string): string => path.basename(file).replace(/\.[^.]+$/, "");

const flowEdges = (layers: StoryLayer[], labels: Record<string, string> | undefined): StoryEdge[] => {
  const flow = layers.filter((layer) => FLOW_LAYERS.includes(layer.layer));
  return flow.slice(1).flatMap((layer, layerIndex) => {
    const previous = flow[layerIndex]?.files ?? [];
    return layer.files.flatMap((file, index): StoryEdge[] => {
      const source = previous[Math.min(index, previous.length - 1)];
      if (!source) return [];
      const label = labels?.[`${nameOf(source.path)}>${nameOf(file.path)}`] ?? labels?.[nameOf(file.path)];
      return [{ from: source.path, to: file.path, ...(label ? { label } : {}) }];
    });
  });
};

export const storyViewOf = (store: Store): StoryView => {
  const row = store.storyRow();
  const live = row.worktree && fs.existsSync(row.worktree) ? snapshotOf(row.worktree) : undefined;
  const snapshot = live && live.files.length > 0 ? live : (row.changes ?? { files: [], tables: [] });
  const layers = LAYERS.flatMap((layer): StoryLayer[] => {
    const files = snapshot.files.filter((file) => layerOf(file.path) === layer);
    if (files.length === 0) return [];
    return [
      {
        layer,
        added: files.reduce((sum, file) => sum + file.added, 0),
        deleted: files.reduce((sum, file) => sum + file.deleted, 0),
        files,
      },
    ];
  });
  return {
    kind: row.kind,
    story: row.story,
    layers,
    edges: flowEdges(layers, row.story?.labels),
    tables: snapshot.tables,
  };
};
