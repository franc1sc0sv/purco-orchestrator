/**
 * CANARY - backend / isolation
 * Rule: isolation-scope-by-owned-entity
 * Violation: the test isolates its rows with a date window instead of its own client, so a claim any other test creates inside that window changes the result.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { ListClaimsUseCase } from "~/server/api/modules/claims/use-cases/list-claims.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("list claims", () => {
  const windowStart = new Date("2026-03-01T00:00:00.000Z");
  const windowEnd = new Date("2026-03-31T23:59:59.999Z");

  let listClaims: ListClaimsUseCase;

  beforeAll(async () => {
    const client = await clientFactory.create();

    await claimFactory.createMany([
      {
        clientId: client.id,
        claimNumber: "C-3001",
        dateReceived: new Date("2026-03-04T12:00:00.000Z"),
      },
      {
        clientId: client.id,
        claimNumber: "C-3002",
        dateReceived: new Date("2026-03-18T12:00:00.000Z"),
      },
    ]);

    listClaims = container.get(ListClaimsUseCase);
  });

  it("returns the claims received inside the requested window", async () => {
    const result = await listClaims.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: {
        dateReceivedFrom: windowStart,
        dateReceivedTo: windowEnd,
        page: 1,
        pageSize: 50,
      },
    });

    expect(result.total).toBe(2);
    expect(result.items.map((claim) => claim.claimNumber)).toEqual([
      "C-3002",
      "C-3001",
    ]);
  });
});
