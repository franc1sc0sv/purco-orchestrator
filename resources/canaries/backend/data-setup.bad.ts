/**
 * CANARY - backend / data-setup
 * Rule: data-setup-through-factories-only
 * Violation: the fixtures are written with raw prisma create calls instead of the factories, so the rows miss the required relations and defaults that the factories keep in one place.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { GetClaimSummaryUseCase } from "~/server/api/modules/claims/use-cases/get-claim-summary.use-case";
import { db } from "~/server/db";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("get claim summary", () => {
  let getClaimSummary: GetClaimSummaryUseCase;
  let claimId: string;

  beforeAll(async () => {
    const organization = await db.prisma.organization.create({
      data: { name: "Canary Holdings", status: "ACTIVE" },
    });

    const client = await db.prisma.client.create({
      data: {
        name: "Canary Rentals",
        organizationId: organization.id,
        status: "ACTIVE",
      },
    });

    const claim = await db.prisma.claim.create({
      data: {
        claimNumber: "C-5150",
        clientId: client.id,
        amountOwed: 82000,
        amountRecovered: 20500,
        status: "OPEN",
      },
    });

    claimId = claim.id;
    getClaimSummary = container.get(GetClaimSummaryUseCase);
  });

  it("summarises the outstanding balance on the claim", async () => {
    const result = await getClaimSummary.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { claimId },
    });

    expect(result).toEqual({
      claimNumber: "C-5150",
      amountOwed: 82000,
      amountRecovered: 20500,
      outstandingBalance: 61500,
      status: "OPEN",
    });
  });
});
