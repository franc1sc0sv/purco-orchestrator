/**
 * CANARY - frontend / async-and-states
 * Rule: async-and-states-await-the-state-and-cover-empty-and-error
 * Violation: the test waits a fixed duration instead of awaiting the rendered state, and it covers only the loaded list, never the empty result and never the failed request.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentHistoryPanel } from "~/client/features/payments/payment-history-panel";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("payment history panel", () => {
  it("shows the payments recorded against the claim", async () => {
    server.use(
      trpcMsw.payments.byClaim.query(() => ({
        items: [
          { id: "pay-1", amount: 30000, paidOn: "2026-03-04", method: "CARD" },
          { id: "pay-2", amount: 15000, paidOn: "2026-03-18", method: "ACH" },
        ],
        total: 2,
      }))
    );

    renderWithProviders(<PaymentHistoryPanel claimId="claim-1" />);

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(screen.getByRole("cell", { name: "$300.00" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "$150.00" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});
