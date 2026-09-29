import { classifyEquivalence } from "../../domain/mutation/attribution.ts";
import { one, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { repoRoot } from "../../infrastructure/git.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import type { MutantOutcome } from "test-forge-contracts/mutation";

export type MutationEquivalenceRecordInput = {
  cwd: string;
  mutantId: number;
  claimedBy: string;
  argument: string;
  refutedBy?: string | undefined;
  refutation?: string | undefined;
  upheld?: boolean | undefined;
  signedBy?: string | undefined;
};

export type MutationEquivalenceRecordResult = {
  claimId: number;
  mutantId: number;
  outcome: MutantOutcome;
  countsTowardD5: boolean;
  needsHumanSignature: boolean;
};

type ClaimIdRow = { id: number };

export const mutationEquivalenceRecord = async ({
  cwd,
  mutantId,
  claimedBy,
  argument,
  refutedBy,
  refutation,
  upheld,
  signedBy,
}: MutationEquivalenceRecordInput): Promise<MutationEquivalenceRecordResult> => {
  const db = openDb();
  await projectKeyOf(await repoRoot(cwd));

  const verdict = {
    upheld: upheld ?? null,
    signedBy: signedBy ?? null,
    refutedBy: refutedBy ?? null,
  };
  const classification = classifyEquivalence(verdict);

  const claimId = tx(db, (txScope) => {
    const existing = one<ClaimIdRow>(
      txScope.db,
      "SELECT id FROM equivalence_claims WHERE mutant_id = ? ORDER BY id DESC LIMIT 1",
      [mutantId],
    );
    if (existing) {
      run(
        txScope.db,
        "UPDATE equivalence_claims SET claimed_by = ?, argument = ?, refuted_by = ?, refutation = ?, upheld = ?, signed_by = ? WHERE id = ?",
        [
          claimedBy,
          argument,
          verdict.refutedBy,
          refutation ?? null,
          verdict.upheld,
          verdict.signedBy,
          existing.id,
        ],
      );
      run(txScope.db, "UPDATE mutants SET outcome = ? WHERE id = ?", [
        classification.outcome,
        mutantId,
      ]);
      return existing.id;
    }
    const inserted = run(
      txScope.db,
      "INSERT INTO equivalence_claims (mutant_id, claimed_by, argument, refuted_by, refutation, upheld, signed_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        mutantId,
        claimedBy,
        argument,
        verdict.refutedBy,
        refutation ?? null,
        verdict.upheld,
        verdict.signedBy,
      ],
    );
    run(txScope.db, "UPDATE mutants SET outcome = ? WHERE id = ?", [
      classification.outcome,
      mutantId,
    ]);
    return Number(inserted.lastInsertRowid);
  });

  return {
    claimId,
    mutantId,
    outcome: classification.outcome,
    countsTowardD5: classification.countsTowardD5,
    needsHumanSignature: classification.needsHumanSignature,
  };
};
