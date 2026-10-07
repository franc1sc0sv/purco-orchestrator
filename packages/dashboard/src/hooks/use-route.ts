import { useEffect, useState } from "react";
import { DEFAULT_TICKET_FILTER, isTicketFilter, type TicketFilter } from "@/lib/ticket-filter";

export type Route =
  | { name: "tickets"; filter: TicketFilter }
  | { name: "ticket"; ticket: string; review: number }
  | { name: "history" }
  | { name: "usage" };

const parse = (hash: string): Route => {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "ticket" && parts[1] !== undefined) {
    return {
      name: "ticket",
      ticket: decodeURIComponent(parts[1]),
      review: parts[2] === "review" ? Date.now() : 0,
    };
  }
  if (parts[0] === "history") return { name: "history" };
  if (parts[0] === "usage") return { name: "usage" };
  const query = new URLSearchParams(hash.split("?")[1] ?? "").get("filter");
  const requested = query === "other" ? "not-recorded" : query;
  return { name: "tickets", filter: isTicketFilter(requested) ? requested : DEFAULT_TICKET_FILTER };
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
};
