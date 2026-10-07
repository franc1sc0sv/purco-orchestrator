import type { TicketSummary } from "@/lib/types";

export const TICKET_FILTERS = ["live", "completed", "other", "all"] as const;

export type TicketFilter = (typeof TICKET_FILTERS)[number];

export const DEFAULT_TICKET_FILTER: TicketFilter = "live";

export const isTicketFilter = (value: string | null): value is TicketFilter =>
  TICKET_FILTERS.some((filter) => filter === value);

const LIVE_STATES: ReadonlySet<TicketSummary["state"]> = new Set(["running", "waiting", "stuck", "halted"]);

type Classifiable = Pick<TicketSummary, "state" | "openItemCount">;

export const classifyTicket = (summary: Classifiable): Exclude<TicketFilter, "all"> => {
  if (summary.openItemCount > 0 || LIVE_STATES.has(summary.state)) return "live";
  if (summary.state === "done") return "completed";
  return "other";
};

export const matchesFilter = (summary: Classifiable, filter: TicketFilter): boolean =>
  filter === "all" || classifyTicket(summary) === filter;

export const countByFilter = (summaries: Classifiable[]): Record<TicketFilter, number> => {
  const counts: Record<TicketFilter, number> = { live: 0, completed: 0, other: 0, all: summaries.length };
  for (const summary of summaries) counts[classifyTicket(summary)] += 1;
  return counts;
};
