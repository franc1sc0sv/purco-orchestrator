import { execFile } from "node:child_process";
import type { AlertKind, Store } from "./store.ts";

const MAX_NOTIFICATION = 200;

const escapeAppleScript = (text: string): string =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOTIFICATION)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

const SHORT_SUBTITLE = 80;

export const notificationSubtitle = (title: string, message: string): string | undefined => {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length <= SHORT_SUBTITLE && flat !== title ? flat : undefined;
};

export const notificationScript = (ticket: string, title: string, subtitle?: string): string =>
  `display notification "${escapeAppleScript(title)}" with title "purco ${escapeAppleScript(ticket)}"${
    subtitle ? ` subtitle "${escapeAppleScript(subtitle)}"` : ""
  }`;

export type Notifier = (ticket: string, title: string, subtitle?: string) => void;

export const macNotifier: Notifier = (ticket, title, subtitle) => {
  if (process.platform !== "darwin") return;
  try {
    execFile("osascript", ["-e", notificationScript(ticket, title, subtitle)], () => undefined);
  } catch {
    return;
  }
};

export type RaiseOptions = {
  workerId?: string;
  step: string;
  title: string;
  dedupeKey?: string;
};

export class Alerts {
  private readonly store: Store;
  private readonly runId: string;
  private readonly ticket: string;
  private readonly notify: Notifier;

  constructor(store: Store, runId: string, ticket: string, notify: Notifier = macNotifier) {
    this.store = store;
    this.runId = runId;
    this.ticket = ticket;
    this.notify = notify;
  }

  raise(kind: AlertKind, message: string, options: RaiseOptions): boolean {
    const { inserted } = this.store.raiseAlert({
      runId: this.runId,
      workerId: options.workerId,
      step: options.step,
      kind,
      message,
      title: options.title,
      dedupeKey: options.dedupeKey,
    });
    if (!inserted) return false;
    this.notify(this.ticket, options.title, notificationSubtitle(options.title, message));
    return true;
  }
}
