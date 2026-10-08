import { useEffect, useState } from "react";

export type ToolTick = { agent: string; at: string };

const REFRESH_MS = 5000;

export const useToolTicks = (ticket: string): ToolTick[] => {
  const [ticks, setTicks] = useState<ToolTick[]>([]);
  useEffect(() => {
    setTicks([]);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/ticks`);
        const parsed: ToolTick[] = await response.json();
        if (active) setTicks(parsed);
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
  }, [ticket]);
  return ticks;
};
