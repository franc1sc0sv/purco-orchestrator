import fs from "node:fs";

export type MutantStatus =
  | "killed"
  | "survived"
  | "equivalent"
  | "error"
  | "no_coverage"
  | "timeout_pending"
  | "killed_by_timeout"
  | "out_of_scope"
  | "unviable";

export type MutantDetail = {
  file: string;
  line: number;
  before: string;
  after: string;
  mutator?: string;
};

export type MutantEvent = MutantDetail & {
  id: number;
  status: MutantStatus;
  ms: number;
  tests?: string[];
};

export type KnownMutants = Map<number, MutantDetail>;

const APPLY_TOOL = "mcp__test-forge__mutation_apply_and_run";
const BATCH_TOOL = "mcp__test-forge__mutation_batch_run";
const GENERATE_TOOL = "mcp__test-forge__mutation_generate";
const EQUIVALENCE_TOOL = "mcp__test-forge__mutation_equivalence_record";

const UNKNOWN_DETAIL: MutantDetail = { file: "", line: 0, before: "", after: "" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const payloadOf = (response: unknown): Record<string, unknown> | undefined => {
  if (typeof response === "string") return payloadOf(parseJson(response));
  if (Array.isArray(response)) {
    const text = response.find((part) => isRecord(part) && typeof part.text === "string");
    return isRecord(text) && typeof text.text === "string" ? payloadOf(text.text) : undefined;
  }
  if (!isRecord(response)) return undefined;
  if (isRecord(response.structuredContent)) return response.structuredContent;
  if (Array.isArray(response.content)) return payloadOf(response.content);
  return response;
};

const readRows = (view: unknown): Record<string, unknown>[] => {
  if (!isRecord(view)) return [];
  if (Array.isArray(view.items)) return view.items.filter(isRecord);
  const handle = view.handle;
  if (!isRecord(handle) || typeof handle.path !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(handle.path, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

const detailOf = (row: Record<string, unknown>): MutantDetail => ({
  file: typeof row.file === "string" ? row.file : "",
  line: typeof row.line === "number" ? row.line : 0,
  before: typeof row.before === "string" ? row.before : "",
  after: typeof row.after === "string" ? row.after : "",
});

const STATUS_BY_OUTCOME: Readonly<Record<string, MutantStatus>> = {
  killed: "killed",
  survived: "survived",
  "equivalent-signed": "equivalent",
  "equivalent-claimed": "survived",
  refuted: "survived",
  no_coverage: "no_coverage",
  timeout_pending: "timeout_pending",
  killed_by_timeout: "killed_by_timeout",
  out_of_scope: "out_of_scope",
  unviable: "unviable",
};

export const statusOfOutcome = (outcome: unknown): MutantStatus =>
  (typeof outcome === "string" ? STATUS_BY_OUTCOME[outcome] : undefined) ?? "error";

const statusOf = statusOfOutcome;

export type LedgerMutantView = {
  id: number;
  file: string;
  line: number;
  mutator: string;
  original: string;
  replacement: string;
  outcome: string;
  killedBy: readonly { file: string; name: string }[];
};

export const plannedOfLedger = (row: LedgerMutantView): PlannedMutant => ({
  id: row.id,
  file: row.file,
  line: row.line,
  before: row.original,
  after: row.replacement,
  mutator: row.mutator,
});

export const eventOfLedger = (row: LedgerMutantView, ms: number): MutantEvent => ({
  ...plannedOfLedger(row),
  status: statusOfOutcome(row.outcome),
  ms,
  ...(row.killedBy.length > 0
    ? { tests: row.killedBy.map((kill) => `${kill.file}::${kill.name}`) }
    : {}),
});

const testsOf = (killedBy: unknown): string[] | undefined => {
  if (!Array.isArray(killedBy) || killedBy.length === 0) return undefined;
  return killedBy
    .filter(isRecord)
    .map((kill) => `${String(kill.file ?? "")}::${String(kill.name ?? "")}`);
};

const eventOf = (
  known: KnownMutants,
  id: number,
  status: MutantStatus,
  ms: number,
  killedBy?: unknown,
): MutantEvent => {
  const tests = testsOf(killedBy);
  return {
    id,
    ...(known.get(id) ?? UNKNOWN_DETAIL),
    status,
    ms,
    ...(tests ? { tests } : {}),
  };
};

export type PlannedMutant = MutantDetail & { id: number };

export const rememberMutants = (
  tool: string,
  response: unknown,
  known: KnownMutants,
): PlannedMutant[] => {
  if (tool !== GENERATE_TOOL) return [];
  const planned = readRows(payloadOf(response)?.mutants).flatMap((row) =>
    typeof row.id === "number" ? [{ id: row.id, ...detailOf(row) }] : [],
  );
  for (const { id, ...detail } of planned) known.set(id, detail);
  return planned;
};

export const mutantEventsOf = (input: {
  tool: string;
  toolInput: Record<string, unknown>;
  response: unknown;
  known: KnownMutants;
  ms: number;
}): MutantEvent[] => {
  const { tool, toolInput, response, known, ms } = input;
  const payload = payloadOf(response);
  if (!payload) return [];
  if (tool === APPLY_TOOL && typeof payload.mutantId === "number") {
    return [eventOf(known, payload.mutantId, statusOf(payload.outcome), ms, payload.killedBy)];
  }
  if (tool === EQUIVALENCE_TOOL && toolInput.upheld === true && typeof toolInput.mutantId === "number") {
    return [eventOf(known, toolInput.mutantId, "equivalent", 0)];
  }
  if (tool !== BATCH_TOOL) return [];
  return readRows(payload.results)
    .filter((row) => typeof row.mutantId === "number" && row.outcome !== "aborted")
    .map((row) =>
      eventOf(
        known,
        Number(row.mutantId),
        statusOf(row.outcome),
        typeof row.durationMs === "number" ? row.durationMs : 0,
        row.killedBy,
      ),
    );
};
