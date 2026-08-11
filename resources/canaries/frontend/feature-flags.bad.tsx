/**
 * CANARY - frontend / feature-flags
 * Rule: feature-flags-pin-every-flag-the-view-reads
 * Violation: the flagged column is asserted without pinning the flag the view reads, so the test rides the harness default and proves nothing about the production configuration where the flag is off.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecoveryPerformanceWidget } from "~/client/features/dashboard/recovery-performance-widget";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("recovery performance widget", () => {
  it("shows the recovery rate against the prior year", async () => {
    server.use(
      trpcMsw.dashboard.recoveryPerformance.query(() => ({
        recoveryRate: 0.42,
        priorYearRecoveryRate: 0.35,
        closedClaims: 118,
      }))
    );

    renderWithProviders(<RecoveryPerformanceWidget period="THIS_QUARTER" />);

    expect(await screen.findByText("42%")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /prior year/i })
    ).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
  });
});
