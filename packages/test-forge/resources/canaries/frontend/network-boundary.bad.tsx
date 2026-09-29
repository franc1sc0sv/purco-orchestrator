/**
 * CANARY - frontend / network-boundary
 * Rule: network-boundary-stub-the-transport-not-the-hook
 * Violation: the data hook module is replaced with a vi.mock stub instead of answering the request at the network boundary, so the query key, the input shape and the loading path are never exercised.
 */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaimsTable } from "~/client/features/claims/claims-table";
import { renderWithProviders } from "~/tests/frontend/frontend-test.util";

vi.mock("~/utils/api", () => ({
  api: {
    claims: {
      list: {
        useQuery: () => ({
          data: {
            items: [
              { id: "claim-1", claimNumber: "C-4412", status: "OPEN" },
              { id: "claim-2", claimNumber: "C-4413", status: "CLOSED" },
            ],
            total: 2,
          },
          isLoading: false,
          isError: false,
        }),
      },
    },
  },
}));

describe("claims table", () => {
  it("lists the claims for the selected client", async () => {
    renderWithProviders(<ClaimsTable clientId="client-1" />);

    const rows = await screen.findAllByRole("row");

    expect(rows).toHaveLength(3);
    expect(screen.getByRole("cell", { name: "C-4412" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "C-4413" })).toBeInTheDocument();
  });
});
