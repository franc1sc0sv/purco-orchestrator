import { randomUUID } from "node:crypto";
import { Store } from "./store.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type MailboxAsk = {
  dbPath: string;
  runId: string;
  question: string;
  fromAgent: string;
  phase: string;
  pollMs?: number;
  timeoutMs?: number;
  onPost?: (id: string) => void;
};

export const askViaMailbox = async (
  ask: MailboxAsk,
): Promise<{ id: string; answer?: string }> => {
  const store = new Store(ask.dbPath, ask.runId);
  const id = `Q-${randomUUID().slice(0, 8)}`;
  store.askQuestion(id, ask.fromAgent, ask.phase, "human", ask.question);
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
