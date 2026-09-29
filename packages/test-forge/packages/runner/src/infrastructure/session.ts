import { DATA_PATH, SESSIONS_FILE } from "./install.ts";
import { EMPTY_TOTALS } from "./spend.ts";
import type { SpendTotals } from "./spend.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type SessionState = SpendTotals & {
  sessionId: string | null;
};

const EMPTY_SESSION: SessionState = { ...EMPTY_TOTALS, sessionId: null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberAt = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const toSession = (value: unknown): SessionState => {
  if (!isRecord(value)) return { ...EMPTY_SESSION };
  const sessionId = value["sessionId"];
  return {
    sessionId: typeof sessionId === "string" ? sessionId : null,
    cycles: numberAt(value, "cycles"),
    outputTokens: numberAt(value, "outputTokens"),
    inputTokens: numberAt(value, "inputTokens"),
    cacheReadTokens: numberAt(value, "cacheReadTokens"),
    costUsd: numberAt(value, "costUsd"),
  };
};

const readAll = (): Record<string, SessionState> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(SESSIONS_FILE, "utf8"));
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const sessions: Record<string, SessionState> = {};
  for (const [key, value] of Object.entries(parsed)) {
    sessions[key] = toSession(value);
  }
  return sessions;
};

const writeAll = (sessions: Record<string, SessionState>): void => {
  mkdirSync(DATA_PATH, { recursive: true });
  writeFileSync(SESSIONS_FILE, `${JSON.stringify(sessions, null, 2)}\n`);
};

export const sessionKeyOf = (projectKey: string, runId: number): string =>
  `${projectKey}::${runId}`;

export const loadSession = (key: string): SessionState =>
  readAll()[key] ?? { ...EMPTY_SESSION };

export const saveSession = (key: string, session: SessionState): void => {
  const sessions = readAll();
  sessions[key] = session;
  writeAll(sessions);
};
