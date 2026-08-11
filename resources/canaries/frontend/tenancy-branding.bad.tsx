/**
 * CANARY - frontend / tenancy-branding
 * Rule: tenancy-branding-drive-branding-from-the-tenant-not-a-literal
 * Violation: the brand name and the logo text are asserted as hardcoded literals of one tenant, so the other tenant's header is never rendered and a wrong brand would ship unnoticed.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppHeader } from "~/client/layout/app-header";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";

describe("app header", () => {
  it("shows the brand and the support line", async () => {
    renderWithProviders(<AppHeader />);

    expect(
      await screen.findByRole("img", { name: "PurCo Recovery Services" })
    ).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent(
      "PurCo Recovery Services"
    );
    expect(screen.getByRole("link", { name: /support/i })).toHaveAttribute(
      "href",
      "mailto:support@purco.com"
    );
  });
});
