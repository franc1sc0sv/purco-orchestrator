import { useEffect, useState } from "react";
import type { FileDiff, FilesView } from "@/lib/types";

const REFRESH_MS = 5000;

export const useFiles = (ticket: string): FilesView | undefined => {
  const [view, setView] = useState<FilesView | undefined>(undefined);
  useEffect(() => {
    setView(undefined);
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/files`);
        const parsed: FilesView = await response.json();
        if (active) setView(parsed);
      } catch {
        if (active) setView((current) => current ?? { files: [] });
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

export const useFileDiff = (ticket: string, file: string | null, version: number): FileDiff | null | undefined => {
  const [diff, setDiff] = useState<FileDiff | null | undefined>(undefined);
  useEffect(() => {
    setDiff(undefined);
    if (file === null) return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/tickets/${encodeURIComponent(ticket)}/diff?path=${encodeURIComponent(file)}`,
        );
        const parsed: FileDiff | null = response.ok ? await response.json() : null;
        if (active) setDiff(parsed);
      } catch {
        if (active) setDiff(null);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [ticket, file, version]);
  return diff;
};
