import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import type { HumanItemKind } from "./types.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type MailboxAsk = {
  dbPath: string;
  runId: string;
  kind: HumanItemKind;
  question: string;
  fromAgent: string;
  phase: string;
  pollMs?: number;
  timeoutMs?: number;
  payload?: unknown;
  onPost?: (id: string) => void;
};

const PREFIX: Record<HumanItemKind, string> = {
  question: "Q",
  gate: "G",
  sign: "S",
};

export const askViaMailbox = async (
  ask: MailboxAsk,
): Promise<{ id: string; answer?: string }> => {
  const store = new Store(ask.dbPath, ask.runId);
  const id = `${PREFIX[ask.kind]}-${randomUUID().slice(0, 8)}`;
  store.askQuestion(id, ask.fromAgent, ask.phase, ask.kind, ask.question, ask.payload);
  ask.onPost?.(id);

  const pollMs = ask.pollMs ?? 2000;
  const deadline =
    ask.timeoutMs && ask.timeoutMs > 0
      ? Date.now() + ask.timeoutMs
      : Number.POSITIVE_INFINITY;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const answer = store.answerFor(id);
    if (answer !== undefined) {
      store.close();
      return { id, answer };
    }
  }

  store.close();
  return { id };
};
