import { useEffect, useState } from "react";
import type { StoryView } from "@/lib/types";

const REFRESH_MS = 5000;

export const useStory = (ticket: string): StoryView | null | undefined => {
  const [view, setView] = useState<StoryView | null | undefined>(undefined);
  useEffect(() => {
    setView(undefined);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/story`);
        const parsed: StoryView | null = await response.json();
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
