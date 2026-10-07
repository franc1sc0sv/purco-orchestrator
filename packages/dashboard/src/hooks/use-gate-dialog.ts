import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "purco.dismissed-items";

const readDismissed = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const writeDismissed = (ids: string[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    return;
  }
};

export const useGateDialog = (
  itemId: string | undefined,
  reviewRequest: number,
): { open: boolean; setOpen: (open: boolean) => void } => {
  const [open, setOpenState] = useState(false);
  const offered = useRef(new Set<string>());
  const handledReview = useRef(0);

  useEffect(() => {
    if (itemId === undefined || offered.current.has(itemId)) return;
    offered.current.add(itemId);
    if (!readDismissed().includes(itemId)) setOpenState(true);
  }, [itemId]);

  useEffect(() => {
    if (reviewRequest === 0 || itemId === undefined || handledReview.current === reviewRequest) return;
    handledReview.current = reviewRequest;
    setOpenState(true);
  }, [reviewRequest, itemId]);

  const setOpen = (next: boolean): void => {
    setOpenState(next);
    if (!next && itemId !== undefined) {
      const dismissed = readDismissed();
      if (!dismissed.includes(itemId)) writeDismissed([...dismissed, itemId]);
    }
  };

  return { open: open && itemId !== undefined, setOpen };
};
