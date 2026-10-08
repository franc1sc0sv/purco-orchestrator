import { useEffect, useState } from "react";
import type { FailuresView } from "@/lib/types";

const REFRESH_MS = 5000;

export const useFailures = (ticket: string): FailuresView | null | undefined => {
  const [view, setView] = useState<FailuresView | null | undefined>(undefined);
  useEffect(() => {
    setView(undefined);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/failures`);
        const parsed: FailuresView | null = await response.json();
        if (active) setView(parsed);
      } catch {
        if (active) setView((current) => current ?? null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ticket]);
  return view;
};
