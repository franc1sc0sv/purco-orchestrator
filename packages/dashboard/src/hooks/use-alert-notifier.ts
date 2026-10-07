import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { jsonPostHeaders } from "@/lib/api";
import { ALERT_TONE, TONES } from "@/lib/colors";
import type { TicketSummary } from "@/lib/types";

const TOAST_MS = 8000;
const FRESH_MS = 30 * 60 * 1000;

const markSeen = async (ticket: string, ids: number[]): Promise<void> => {
  try {
    await fetch(`/api/tickets/${encodeURIComponent(ticket)}/alerts/seen`, {
      method: "POST",
      headers: jsonPostHeaders(),
      body: JSON.stringify({ ids }),
    });
  } catch {
    return;
  }
};

const notify = (ticket: string, title: string): void => {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  new Notification(title, { body: `purco ${ticket}` });
};

export const useAlertNotifier = (tickets: TicketSummary[] | undefined): void => {
  const handled = useRef(new Set<number>());

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!tickets) return;
    for (const summary of tickets) {
      const fresh = summary.unseenAlerts.filter((alert) => !handled.current.has(alert.id));
      if (fresh.length === 0) continue;
      for (const alert of fresh) {
        handled.current.add(alert.id);
        if (Date.now() - Date.parse(alert.at) > FRESH_MS) continue;
        notify(summary.ticket, alert.title);
        toast(alert.title, {
          description: `purco ${summary.ticket}`,
          duration: TOAST_MS,
          className: `border-l-4 ${TONES[ALERT_TONE[alert.kind]].vars} ${TONES[ALERT_TONE[alert.kind]].borderLeft}`,
          action: {
            label: "Review",
            onClick: () => {
              window.location.hash = `#/ticket/${encodeURIComponent(summary.ticket)}/review`;
            },
          },
        });
      }
      void markSeen(
        summary.ticket,
        fresh.map((alert) => alert.id),
      );
    }
  }, [tickets]);
};
