/**
 * CANARY - frontend / querying
 * Rule: querying-by-accessible-role-and-text
 * Violation: the elements are found by test id and by generated class name, so the test passes even when the control has no accessible name and no user could find it.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ClaimSummaryCard } from "~/client/features/claims/claim-summary-card";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("claim summary card", () => {
  it("opens the balance breakdown when the user asks for it", async () => {
    server.use(
      trpcMsw.claims.summary.query(() => ({
        claimNumber: "C-4412",
        amountOwed: 82000,
        amountRecovered: 20500,
        outstandingBalance: 61500,
      }))
    );

    const { container } = renderWithProviders(
      <ClaimSummaryCard claimId="claim-1" />
    );

    const breakdownToggle = await screen.findByTestId(
      "balance-breakdown-toggle"
    );
    await userEvent.click(breakdownToggle);

    const amounts = container.querySelectorAll(".mantine-Text-root");

    expect(screen.getByTestId("outstanding-balance").textContent).toBe(
      "$615.00"
    );
    expect(amounts[1]?.textContent).toBe("$205.00");
  });
});
