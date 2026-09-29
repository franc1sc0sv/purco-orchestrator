/**
 * CANARY - frontend / forms-validation
 * Rule: forms-validation-assert-the-message-the-user-reads
 * Violation: the test proves the field carries a required attribute instead of submitting invalid input and asserting the message the user reads, so every validation rule could be deleted and the test would stay green.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RecordPaymentForm } from "~/client/features/payments/record-payment-form";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("record payment form", () => {
  it("records the payment the user enters", async () => {
    server.use(
      trpcMsw.payments.record.mutation(() => ({
        id: "pay-9",
        amount: 25000,
        method: "ACH",
      }))
    );

    renderWithProviders(<RecordPaymentForm claimId="claim-1" />);

    const amountField = screen.getByRole("spinbutton", { name: /amount/i });
    const referenceField = screen.getByRole("textbox", { name: /reference/i });

    expect(amountField).toBeRequired();
    expect(referenceField).toBeRequired();

    await userEvent.type(amountField, "250");
    await userEvent.type(referenceField, "ACH-77120");
    await userEvent.click(
      screen.getByRole("button", { name: /record payment/i })
    );

    expect(await screen.findByText("Payment recorded")).toBeInTheDocument();
  });
});
