import type { TicketSummary } from "@/lib/types";

export const TICKET_FILTERS = ["live", "failed", "completed", "not-recorded", "all"] as const;

export type TicketFilter = (typeof TICKET_FILTERS)[number];

export type TicketGroup = Exclude<TicketFilter, "all">;

export const DEFAULT_TICKET_FILTER: TicketFilter = "live";

export const isTicketFilter = (value: string | null): value is TicketFilter =>
  TICKET_FILTERS.some((filter) => filter === value);

const ACTIVE_STATES: ReadonlySet<TicketSummary["state"]> = new Set(["running", "waiting", "stuck"]);

type Classifiable = Pick<TicketSummary, "state" | "openItemCount" | "recorded">;

export const classifyTicket = (summary: Classifiable): TicketGroup => {
  if (summary.openItemCount > 0) return "live";
  if (summary.state === "failed" || summary.state === "halted") return "failed";
  if (summary.state === "done") return "completed";
  if (ACTIVE_STATES.has(summary.state)) return "live";
  return summary.recorded ? "live" : "not-recorded";
};

export const matchesFilter = (summary: Classifiable, filter: TicketFilter): boolean =>
  filter === "all" || classifyTicket(summary) === filter;

export const countByFilter = (summaries: Classifiable[]): Record<TicketFilter, number> => {
  const counts: Record<TicketFilter, number> = {
    live: 0,
    failed: 0,
    completed: 0,
    "not-recorded": 0,
    all: summaries.length,
  };
  for (const summary of summaries) counts[classifyTicket(summary)] += 1;
  return counts;
};
