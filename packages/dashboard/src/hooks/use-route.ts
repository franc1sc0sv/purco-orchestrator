import { useEffect, useState } from "react";
import { DEFAULT_TICKET_FILTER, isTicketFilter, type TicketFilter } from "@/lib/ticket-filter";

export const TICKET_TABS = ["live", "story", "plan", "files", "tests", "timeline", "failures", "feedback"] as const;
export type TicketTab = (typeof TICKET_TABS)[number];

export type Route =
  | { name: "tickets"; filter: TicketFilter }
  | { name: "ticket"; ticket: string; tab: TicketTab; params: URLSearchParams; review: number }
  | { name: "history" }
  | { name: "usage" };

export const isTicketTab = (value: string | undefined): value is TicketTab =>
  TICKET_TABS.some((tab) => tab === value);

export const ticketHref = (ticket: string, tab: TicketTab, query?: Record<string, string | number>): string => {
  const search = query ? `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}` : "";
  return `#/t/${encodeURIComponent(ticket)}/${tab}${search}`;
};

const legacyTarget = (hash: string): string | undefined => {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "ticket" || parts[1] === undefined) return undefined;
  const ticket = decodeURIComponent(parts[1]);
  return parts[2] === "review" ? ticketHref(ticket, "live", { review: 1 }) : ticketHref(ticket, "live");
};

const parse = (hash: string): Route => {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1] !== undefined) {
    const params = new URLSearchParams(search);
    return {
      name: "ticket",
      ticket: decodeURIComponent(parts[1]),
      tab: isTicketTab(parts[2]) ? parts[2] : "live",
      params,
      review: params.has("review") ? Date.now() : 0,
    };
  }
  if (parts[0] === "history") return { name: "history" };
  if (parts[0] === "usage") return { name: "usage" };
  const query = new URLSearchParams(search).get("filter");
  const requested = query === "other" ? "not-recorded" : query;
  return { name: "tickets", filter: isTicketFilter(requested) ? requested : DEFAULT_TICKET_FILTER };
};

const current = (): Route => {
  const target = legacyTarget(window.location.hash);
  if (target) window.location.replace(target);
  return parse(target ?? window.location.hash);
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(current);
  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
};
