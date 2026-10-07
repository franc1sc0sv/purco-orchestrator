import type { PlanGatePayload } from "./gate-payload.ts";

const MAX_TITLE = 70;
const FALLBACK_TITLE = 80;
const QUESTION_PREVIEW = 50;
const SHORT_NAME = 24;

export const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

const capitalize = (text: string): string => (text ? `${text[0]?.toUpperCase()}${text.slice(1)}` : text);

export const shortName = (value: string): string => {
  const leaf = value.split(/[:/]/).filter(Boolean).pop() ?? value;
  const stem = leaf.split(".")[0] ?? leaf;
  const head = stem.split("-for-")[0] ?? stem;
  return clip(head, SHORT_NAME);
};

export const fallbackTitle = (message: string): string => clip(message.split("\n")[0] ?? "", FALLBACK_TITLE);

const rolePrefix = (role: string | undefined): string => capitalize(role ?? "Run");

const isPlanGatePayload = (payload: unknown): payload is PlanGatePayload =>
  typeof payload === "object" && payload !== null && "type" in payload && payload.type === "test-plan";

export const gateTitle = (step: string, payload?: unknown): string => {
  if (!isPlanGatePayload(payload)) return clip(`${capitalize(shortName(step))} gate waits`, MAX_TITLE);
  const rows = payload.units.reduce((sum, unit) => sum + unit.rows, 0);
  return `Test plan waits · run ${payload.runId} · ${payload.units.length} files · ${rows} rows`;
};

export const questionTitle = (role: string | undefined, question: string): string =>
  clip(`${rolePrefix(role)} asks: ${clip(question, QUESTION_PREVIEW)}`, MAX_TITLE);

export const signTitle = (text: string): string => {
  const count = /(\d+) waiver/.exec(text)?.[1];
  if (count) return `Signature needed: ${count} waiver(s)`;
  if (/mutant/.test(text)) return "Signature needed: equivalence";
  return "Signature needed: 1 waiver(s)";
};

export const humanTitle = (
  kind: "gate" | "question" | "sign",
  input: { text: string; step: string; role?: string; payload?: unknown },
): string => {
  if (kind === "gate") return gateTitle(input.step, input.payload);
  if (kind === "sign") return signTitle(input.text);
  return questionTitle(input.role, input.text);
};

export const burnTitle = (input: { role: string; step: string; level: number; rate: number }): string =>
  `${capitalize(input.role)} ${shortName(input.step)} · ${input.level}× normal (${Math.round(input.rate / 1000)}k/min)`;

export const stuckTitle = (input: { role: string; step: string; minutes: number }): string =>
  `${capitalize(input.role)} ${shortName(input.step)} stuck ${input.minutes} min`;

export const loopTitle = (tool: string): string => clip(`loop: ${tool}`, MAX_TITLE);

export const haltedTitle = (reason: string): string => clip(`halted: ${reason}`, MAX_TITLE);

export const doneTitle = (costUsd: number): string => `Ticket done · $${costUsd.toFixed(2)}`;
