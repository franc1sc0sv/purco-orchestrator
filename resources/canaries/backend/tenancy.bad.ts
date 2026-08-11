/**
 * CANARY - backend / tenancy
 * Rule: tenancy-no-hardcoded-tenant-names
 * Violation: the test branches on a hardcoded tenant string read straight from the environment instead of the tenant utilities, so it silently skips its only assertion on the other tenant.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { BuildStatementHeaderUseCase } from "~/server/api/modules/statements/use-cases/build-statement-header.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("build statement header", () => {
  let buildStatementHeader: BuildStatementHeaderUseCase;
  let claimId: string;

  beforeAll(async () => {
    const client = await clientFactory.create({ name: "Northwind Rentals" });
    const claim = await claimFactory.create({
      clientId: client.id,
      claimNumber: "C-7781",
    });

    claimId = claim.id;
    buildStatementHeader = container.get(BuildStatementHeaderUseCase);
  });

  it("names the recovering party on the statement header", async () => {
    const result = await buildStatementHeader.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { claimId },
    });

    if (process.env.APPLICATION === "PURCO") {
      expect(result).toEqual({
        claimNumber: "C-7781",
        recoveringParty: "PurCo Recovery Services",
        remitTo: "PurCo Recovery Services, Lockbox 4410",
      });
    }
  });
});
