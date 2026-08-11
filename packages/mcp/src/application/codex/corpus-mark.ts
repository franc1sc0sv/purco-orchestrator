import {
  readCorpusHash,
  writeCorpusHash,
} from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { Scope } from "test-forge-contracts/project";

export type CorpusMarkInput = {
  cwd: string;
  scope: Scope;
  aspect: string;
  corpusHash: string;
};

export type CorpusMarkResult = {
  projectKey: string;
  scope: Scope;
  aspect: string;
  corpusHash: string;
  sampledAt: string | null;
};

export const corpusMark = async ({
  cwd,
  scope,
  aspect,
  corpusHash,
}: CorpusMarkInput): Promise<CorpusMarkResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  writeCorpusHash(db, projectKey, scope, aspect, corpusHash);
  return {
    projectKey,
    scope,
    aspect,
    corpusHash,
    sampledAt: readCorpusHash(db, projectKey, scope, aspect)?.sampledAt ?? null,
  };
};
