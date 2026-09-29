/**
 * CANARY - frontend / accessibility
 * Rule: accessibility-name-the-control-and-announce-the-outcome
 * Violation: the icon button is reached by its position in the button list rather than by an accessible name, and the outcome is asserted as loose text with no live region, so a control no screen reader can name still passes.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InvolvedPartyRow } from "~/client/features/claims/involved-party-row";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("involved party row", () => {
  it("removes the involved party from the claim", async () => {
    server.use(
      trpcMsw.involvedParties.remove.mutation(() => ({ id: "party-1" }))
    );

    renderWithProviders(
      <InvolvedPartyRow claimId="claim-1" involvedPartyId="party-1" />
    );

    const buttons = await screen.findAllByRole("button");
    await userEvent.click(buttons[2]);

    expect(screen.getByText("Involved party removed")).toBeInTheDocument();
  });
});
