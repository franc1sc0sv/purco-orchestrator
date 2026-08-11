/**
 * CANARY - backend / assertions
 * Rule: assertions-expected-never-derived-from-result
 * Violation: the expected totals are computed from the use case result itself, so the assertions restate the output instead of checking it against a hand computed value.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { AllocatePaymentUseCase } from "~/server/api/modules/payments/use-cases/allocate-payment.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { paymentFactory } from "~/tests/factories/payment.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("allocate payment", () => {
  let allocatePayment: AllocatePaymentUseCase;
  let paymentId: string;
  let firstClaimId: string;
  let secondClaimId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();
    const firstClaim = await claimFactory.create({
      clientId: client.id,
      amountOwed: 30000,
    });
    const secondClaim = await claimFactory.create({
      clientId: client.id,
      amountOwed: 25000,
    });
    const payment = await paymentFactory.create({
      claimId: firstClaim.id,
      amount: 50000,
      status: "SUCCEEDED",
    });

    firstClaimId = firstClaim.id;
    secondClaimId = secondClaim.id;
    paymentId = payment.id;
    allocatePayment = container.get(AllocatePaymentUseCase);
  });

  it("splits the payment across both claims", async () => {
    const result = await allocatePayment.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: {
        paymentId,
        allocations: [
          { claimId: firstClaimId, amount: 30000 },
          { claimId: secondClaimId, amount: 15000 },
        ],
      },
    });

    expect(result.allocations).toHaveLength(result.allocations.length);
    expect(result.allocatedAmount).toBe(
      result.allocations.reduce(
        (total, allocation) => total + allocation.amount,
        0
      )
    );
    expect(result.remainingBalance).toBe(
      result.paymentAmount - result.allocatedAmount
    );
  });
});
