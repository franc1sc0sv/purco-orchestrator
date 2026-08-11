import {
  readAspectIndex,
  readCorpusHash,
  readCurrentRows,
} from "../../infrastructure/db/codex-store.ts";
import type { AspectEntry } from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { seedTaxonomy } from "../../infrastructure/doctrine.ts";
import type { BlockingBar } from "../../infrastructure/doctrine.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { Scope } from "test-forge-contracts/project";

export type AspectsInput = {
  cwd: string;
  scope?: Scope | undefined;
  corpusHashes?: Record<string, string> | undefined;
};

export type AspectReport = AspectEntry & {
  ruleCount: number;
  sampledCorpusHash: string | null;
  sampledAt: string | null;
  currentCorpusHash: string | null;
  stale: boolean;
  staleReason: string;
};

export type AspectsResult = {
  projectKey: string;
  scope: string;
  blockingBars: Record<string, BlockingBar>;
  aspects: AspectReport[];
  staleCount: number;
};

const NEVER_SWEPT = "This aspect has never been swept for this project.";

const CORPUS_MOVED = "The corpus changed since the last sweep of this aspect.";

export const aspects = async ({
  cwd,
  scope,
  corpusHashes,
}: AspectsInput): Promise<AspectsResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  const index = readAspectIndex(db, projectKey);
  const counts = new Map<string, number>();
  for (const row of readCurrentRows(db, projectKey, scope)) {
    const key = `${row.scope}:${row.aspect}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const supplied = corpusHashes ?? {};

  const list = [...index.values()]
    .filter((entry) => scope === undefined || entry.scope === scope)
    .map((entry) => {
      const key = `${entry.scope}:${entry.id}`;
      const sampled = readCorpusHash(db, projectKey, entry.scope, entry.id);
      const currentCorpusHash = supplied[entry.id] ?? supplied[key] ?? null;
      const stale =
        sampled === null ||
        (currentCorpusHash !== null && currentCorpusHash !== sampled.hash);
      return {
        ...entry,
        ruleCount: counts.get(key) ?? 0,
        sampledCorpusHash: sampled?.hash ?? null,
        sampledAt: sampled?.sampledAt ?? null,
        currentCorpusHash,
        stale,
        staleReason: sampled === null ? NEVER_SWEPT : stale ? CORPUS_MOVED : "",
      };
    })
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id));

  return {
    projectKey,
    scope: scope ?? "all",
    blockingBars: seedTaxonomy().blockingBars,
    aspects: list,
    staleCount: list.filter((entry) => entry.stale).length,
  };
};
