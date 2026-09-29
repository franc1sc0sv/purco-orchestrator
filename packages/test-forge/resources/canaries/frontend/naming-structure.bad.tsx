/**
 * CANARY - frontend / naming-structure
 * Rule: naming-structure-one-behaviour-per-test-named-in-present-tense
 * Violation: the suite is named after the component file path and one test carries four unrelated behaviours behind a "should work" title, so a failure names neither the behaviour nor the step that broke.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ClaimFilters } from "~/client/features/claims/claim-filters";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";
import { trpcMsw, server } from "~/tests/frontend/trpc-msw";

describe("src/client/features/claims/claim-filters.tsx", () => {
  describe("ClaimFilters component", () => {
    it("should work as expected", async () => {
      server.use(
        trpcMsw.clients.options.query(() => [
          { id: "client-1", name: "Northwind Rentals" },
        ])
      );

      renderWithProviders(<ClaimFilters />);

      expect(
        await screen.findByRole("combobox", { name: /client/i })
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("combobox", { name: /client/i }));
      await userEvent.click(
        screen.getByRole("option", { name: "Northwind Rentals" })
      );

      expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue(
        "Northwind Rentals"
      );

      await userEvent.click(
        screen.getByRole("checkbox", { name: /open only/i })
      );

      expect(
        screen.getByRole("checkbox", { name: /open only/i })
      ).toBeChecked();

      await userEvent.click(screen.getByRole("button", { name: /clear/i }));

      expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue("");
      expect(
        screen.getByRole("checkbox", { name: /open only/i })
      ).not.toBeChecked();
    });
  });
});
