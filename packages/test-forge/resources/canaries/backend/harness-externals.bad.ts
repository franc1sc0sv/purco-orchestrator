/**
 * CANARY - backend / harness-externals
 * Rule: harness-externals-use-the-local-double-not-a-module-mock
 * Violation: the external payment provider is replaced with a module level vi.mock instead of the local stripe-mock container, so the test asserts against a hand written stub and never touches the real client contract.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { container } from "~/server/api/container";
import { CreatePaymentIntentUseCase } from "~/server/api/modules/payments/use-cases/create-payment-intent.use-case";
import { claimFactory } from "~/tests/factories/claim.factory";
import { clientFactory } from "~/tests/factories/client.factory";
import { createMockContext } from "~/tests/utils/create-mock-context";

vi.mock("~/server/api/services/stripe/stripe.client", () => ({
  stripeClient: {
    paymentIntents: {
      create: vi.fn().mockResolvedValue({
        id: "pi_canary_1",
        status: "requires_capture",
        amount: 75000,
      }),
    },
  },
}));

describe("create payment intent", () => {
  let createPaymentIntent: CreatePaymentIntentUseCase;
  let claimId: string;

  beforeAll(async () => {
    const client = await clientFactory.create();
    const claim = await claimFactory.create({ clientId: client.id });

    claimId = claim.id;
    createPaymentIntent = container.get(CreatePaymentIntentUseCase);
  });

  it("holds the authorised amount against the claim", async () => {
    const result = await createPaymentIntent.execute({
      ctx: createMockContext({ role: "ADMIN" }),
      input: { claimId, amount: 75000 },
    });

    expect(result).toEqual({
      claimId,
      providerIntentId: "pi_canary_1",
      status: "AUTHORIZED",
      amount: 75000,
    });
  });
});
