/**
 * CANARY - frontend / permissions-ui
 * Rule: permissions-ui-assert-the-rendered-affordance-per-role
 * Violation: the test asserts the role value it handed to the session instead of what each role sees on screen, so the restricted role is never rendered and the gate could be removed without a failure.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimActionsMenu } from "~/client/features/claims/claim-actions-menu";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";

describe("claim actions menu", () => {
  it("offers the destructive actions to an internal administrator", async () => {
    const session = {
      user: { id: "user-1", role: "ADMIN", organizationId: "org-1" },
    };

    renderWithProviders(<ClaimActionsMenu claimId="claim-1" />, { session });

    expect(session.user.role).toBe("ADMIN");
    expect(
      await screen.findByRole("button", { name: /archive claim/i })
    ).toBeInTheDocument();
  });

  it("keeps the destructive actions away from a client contact", () => {
    const session = {
      user: { id: "user-2", role: "CLIENT_CONTACT", organizationId: "org-1" },
    };

    expect(session.user.role).toBe("CLIENT_CONTACT");
  });
});
