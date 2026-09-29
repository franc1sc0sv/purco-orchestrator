/**
 * CANARY - frontend / interaction
 * Rule: interaction-through-user-event-not-fireevent
 * Violation: the test drives the component with raw fireEvent calls and writes into the input value directly, so it skips the focus, key and change sequence a real person produces.
 */
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaimNoteComposer } from "~/client/features/claims/claim-note-composer";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("claim note composer", () => {
  it("saves the note the user writes", async () => {
    server.use(
      trpcMsw.notes.create.mutation(() => ({
        id: "note-1",
        body: "Insurer confirmed coverage",
      }))
    );

    renderWithProviders(<ClaimNoteComposer claimId="claim-1" />);

    const noteInput = screen.getByRole("textbox", { name: /note/i });

    fireEvent.focus(noteInput);
    fireEvent.change(noteInput, {
      target: { value: "Insurer confirmed coverage" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(
      await screen.findByText("Insurer confirmed coverage")
    ).toBeInTheDocument();
  });
});
