/**
 * CANARY - backend / feature-flags
 * Rule: feature-flags-pin-every-flag-the-behaviour-reads
 * Violation: the behaviour under test is gated by a flag that the test never pins, so it passes on the harness default and says nothing about the production configuration where the flag is off.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { ExportClaimsUseCase } from "~/server/api/modules/reports/use-cases/export-claims.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("export claims", () => {
  let exportClaims: ExportClaimsUseCase;
  let clientId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();

    await claimFactory.createMany([
      { clientId: client.id, claimNumber: "C-9001", amountOwed: 12000 },
      { clientId: client.id, claimNumber: "C-9002", amountOwed: 34000 },
    ]);

    clientId = client.id;
    exportClaims = container.get(ExportClaimsUseCase);
  });

  it("includes the recovery columns in the export", async () => {
    const result = await exportClaims.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { clientId, format: "CSV" },
    });

    expect(result.columns).toEqual([
      "claimNumber",
      "amountOwed",
      "amountRecovered",
      "recoveryRate",
    ]);
    expect(result.rowCount).toBe(2);
  });
});
