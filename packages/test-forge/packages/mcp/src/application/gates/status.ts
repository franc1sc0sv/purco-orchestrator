import {
  gateById,
  gateStatusOf,
  predicateReports,
} from "../../domain/gates/gates.ts";
import { evaluatePredicates } from "../../domain/gates/predicates.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import {
  EVIDENCE_KINDS,
  gatherEvidence,
  latestEvidence,
  openGateEvidence,
} from "./evidence.ts";
import type { EvidenceKind } from "./evidence.ts";
import type {
  GateId,
  GateStatus,
  PredicateReport,
} from "test-forge-contracts/gates";

export type GateStatusOptions = {
  cwd: string;
  runId: number;
  gate: number;
};

export type StoredEvidence = {
  kind: EvidenceKind;
  stored: boolean;
  ok: boolean | null;
  recordedAt: string | null;
};

export type GateStatusReport = {
  projectKey: string;
  runId: number;
  gate: GateId;
  name: string;
  status: GateStatus;
  predicates: PredicateReport[];
  evidence: StoredEvidence[];
};

export const gateStatus = async ({
  cwd,
  runId,
  gate,
}: GateStatusOptions): Promise<GateStatusReport> => {
  const definition = gateById(gate);
  if (definition === null) {
    throw new Error(`gate must be 1 through 8 but was "${gate}"`);
  }

  const db = openGateEvidence();
  const { projectKey, rootPath } = await resolveProject(cwd);
  const table = evaluatePredicates(
    await gatherEvidence({ cwd, runId, projectKey, rootPath })
  );

  return {
    projectKey,
    runId,
    gate: definition.gate,
    name: definition.name,
    status: gateStatusOf(definition, table),
    predicates: predicateReports(definition, table),
    evidence: EVIDENCE_KINDS.map((kind) => {
      const row = latestEvidence(db, runId, kind, "");
      return {
        kind,
        stored: row !== null,
        ok: row === null ? null : row.ok === 1,
        recordedAt: row === null ? null : row.created_at,
      };
    }),
  };
};
