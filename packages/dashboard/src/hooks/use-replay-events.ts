import { useEffect, useState } from "react";
import type { StreamEvent } from "@/lib/types";

export const useReplayEvents = (ticket: string, at: number | null): StreamEvent[] | undefined => {
  const [loaded, setLoaded] = useState<{ at: number; events: StreamEvent[] } | undefined>(undefined);
  useEffect(() => {
    if (at === null) return;
    let active = true;
    const until = new Date(at).toISOString();
    fetch(`/api/tickets/${encodeURIComponent(ticket)}/events?until=${encodeURIComponent(until)}`)
      .then((response) => response.json())
      .then((events: StreamEvent[]) => {
        if (active) setLoaded({ at, events });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ticket, at]);
  return at !== null && loaded?.at === at ? loaded.events : undefined;
};
