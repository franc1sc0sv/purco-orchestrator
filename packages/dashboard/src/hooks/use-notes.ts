import { useCallback, useEffect, useState } from "react";
import type { Note } from "@/lib/types";

const REFRESH_MS = 3000;

export const useNotes = (ticket: string): { notes: Note[]; reload: () => void } => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setNotes([]);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/notes`);
        const parsed: Note[] = await response.json();
        if (active) setNotes(parsed);
      } catch {
        return;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ticket, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { notes, reload };
};
