/**
 * CANARY - backend / naming-structure
 * Rule: naming-structure-present-tense-behaviour-names
 * Violation: the suite is named after the source file and the tests are named after the mechanics rather than the behaviour, so a failure line names nothing a reader can act on.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { CloseClaimUseCase } from "~/server/api/modules/claims/use-cases/close-claim.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("close-claim.use-case.ts", () => {
  describe("execute()", () => {
    describe("tests", () => {
      let closeClaim: CloseClaimUseCase;
      let claimId: string;

      beforeAll(async () => {
        const client = await clientFactory.create();
        const claim = await claimFactory.create({
          clientId: client.id,
          claimNumber: "C-6620",
          status: "OPEN",
          amountOwed: 40000,
          amountRecovered: 40000,
        });

        claimId = claim.id;
        closeClaim = container.get(CloseClaimUseCase);
      });

      it("should work", async () => {
        const result = await closeClaim.execute({
          ctx: createMockContext({ role: "ADMIN" }),
          input: { claimId, closeReason: "PAID_IN_FULL" },
        });

        expect(result).toEqual({
          id: claimId,
          claimNumber: "C-6620",
          status: "CLOSED",
          closeReason: "PAID_IN_FULL",
          outstandingBalance: 0,
        });
      });
    });
  });
});
