import { kindPrefixOf } from "../../domain/closure/graph.ts";
import {
  acceptExistingTest,
  acceptNewCase,
  acceptWaiver,
  citationOf,
  citationPresent,
  rejectCitation,
  rejectMissingFile,
  rejectUnknownKind,
  validateResolution,
  verifierOf,
} from "../../domain/closure/resolution.ts";
import type { ResolutionOutcome } from "../../domain/closure/resolution.ts";
import { openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { readTextFile } from "../../infrastructure/files.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Resolution, ResolutionState } from "test-forge-contracts/closure";

export type ClosureResolveInput = {
  cwd: string;
  runId: number;
  nodeId: string;
  resolution: Resolution;
};

export type ClosureResolveResult = ResolutionOutcome;

const testNamesIn = (text: string): Set<string> => {
  const names = new Set<string>();
  const pattern = /\b(?:it|test)(?:\.\w+)*\s*\(\s*(["'`])([\s\S]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null)
    names.add((match[2] ?? "").trim());
  return names;
};

const ensureNode = (
  db: DatabaseSync,
  projectKey: string,
  runId: number,
  nodeId: string,
): void => {
  run(
    db,
    "INSERT OR IGNORE INTO radius_nodes (project_key, run_id, node_ref, node_kind) VALUES (?, ?, ?, ?)",
    [projectKey, runId, nodeId, kindPrefixOf(nodeId)],
  );
};

const markNode = (
  db: DatabaseSync,
  runId: number,
  nodeId: string,
  state: ResolutionState,
  citedTest: string | null,
  verifiedBy: string | null,
): void => {
  run(
    db,
    "UPDATE radius_nodes SET resolution = ?, cited_test = ?, verified_by = ? WHERE run_id = ? AND node_ref = ?",
    [state, citedTest, verifiedBy, runId, nodeId],
  );
};

export const closureResolve = async ({
  cwd,
  runId,
  nodeId,
  resolution,
}: ClosureResolveInput): Promise<ClosureResolveResult> => {
  const invalid = validateResolution(resolution);
  if (invalid) return invalid;

  const requestedKind: string = resolution.kind;
  const root = resolve(cwd);
  const db = openDb();
  const projectKey = await projectKeyOf(root);

  if (resolution.kind === "existing-test") {
    const { testFile, testName } = resolution;
    const full = testFile.startsWith(root) ? testFile : join(root, testFile);
    const text = readTextFile(full);
    if (text === null) return rejectMissingFile(testFile);
    const names = testNamesIn(text);
    if (!citationPresent(names, testName))
      return rejectCitation(testFile, testName, names);
    tx(db, (txScope) => {
      ensureNode(txScope.db, projectKey, runId, nodeId);
      markNode(
        txScope.db,
        runId,
        nodeId,
        "existing-test",
        citationOf(testFile, testName),
        verifierOf(resolution.verifiedBy),
      );
    });
    return acceptExistingTest(testFile, testName);
  }

  if (resolution.kind === "new-case") {
    const testRef = resolution.testRef ?? "";
    tx(db, (txScope) => {
      ensureNode(txScope.db, projectKey, runId, nodeId);
      markNode(txScope.db, runId, nodeId, "new-case", testRef, null);
    });
    return acceptNewCase(testRef);
  }

  if (resolution.kind === "waived") {
    const { reason, signedBy } = resolution;
    tx(db, (txScope) => {
      ensureNode(txScope.db, projectKey, runId, nodeId);
      markNode(txScope.db, runId, nodeId, "waived", null, signedBy);
      run(
        txScope.db,
        "INSERT OR REPLACE INTO waivers (project_key, run_id, kind, ref, reason, signed_by) VALUES (?, ?, 'radius-node', ?, ?, ?)",
        [projectKey, runId, nodeId, reason, signedBy],
      );
    });
    return acceptWaiver(signedBy);
  }

  return rejectUnknownKind(requestedKind);
};
