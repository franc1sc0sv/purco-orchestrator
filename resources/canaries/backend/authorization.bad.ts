/**
 * CANARY - backend / authorization
 * Rule: authorization-exercise-the-denied-role
 * Violation: the use case is role gated and the test drives only the permitted role, so deleting the role gate from the source would leave every assertion green.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { container } from "~/server/api/container";
import { VoidPaymentUseCase } from "~/server/api/modules/payments/use-cases/void-payment.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { paymentFactory } from "~/tests/factories/payment.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

describe("void payment", () => {
  let voidPayment: VoidPaymentUseCase;
  let paymentId: string;
  let organizationId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();
    const claim = await claimFactory.create({ clientId: client.id });
    const payment = await paymentFactory.create({
      claimId: claim.id,
      amount: 45000,
      status: "SUCCEEDED",
    });

    organizationId = client.organizationId;
    paymentId = payment.id;
    voidPayment = container.get(VoidPaymentUseCase);
  });

  it("voids the payment for an admin", async () => {
    const result = await voidPayment.execute({
      ctx: createMockContext({ role: "ADMIN", organizationId }),
      input: { paymentId, reason: "Duplicate capture" },
    });

    expect(result).toEqual({
      id: paymentId,
      status: "VOIDED",
      voidReason: "Duplicate capture",
      amount: 45000,
    });
  });
});
