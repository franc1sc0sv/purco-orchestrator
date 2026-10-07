import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LimitSource = "statusline" | "engine";

export type LimitWindow = {
  pct: number;
  resetsAt: number;
  at: number;
  source: LimitSource;
};

export type ModelLimit = LimitWindow & { model: string };

export type PlanLimits = {
  session?: LimitWindow;
  weekly?: LimitWindow;
  weeklyByModel: ModelLimit[];
  installCommand: string;
};

export type EngineLimitEntry = {
  utilization: number;
  resetsAt: number;
  status: string;
  at: number;
};

export type EngineLimitInfo = {
  status: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
};

const STATUSLINE_SCRIPT = path.resolve(import.meta.dirname, "..", "bin", "statusline.sh");

export const installCommand = (): string =>
  `jq --arg cmd "bash ${STATUSLINE_SCRIPT}" '.statusLine = {type: "command", command: $cmd}' ~/.claude/settings.json > ~/.claude/settings.json.tmp && mv ~/.claude/settings.json.tmp ~/.claude/settings.json`;

const SECONDS_CEILING = 1e11;

const dataDir = (): string => path.join(os.homedir(), ".purco-dashboard");
const statuslineFile = (): string => path.join(dataDir(), "limits-statusline.json");
const engineFile = (): string => path.join(dataDir(), "limits-engine.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toMillis = (epoch: number): number => (epoch < SECONDS_CEILING ? epoch * 1000 : epoch);

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const writeAtomic = (file: string, value: unknown): void => {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  } catch {
    fs.rmSync(temp, { force: true });
  }
};

export const recordEngineLimit = (info: EngineLimitInfo, now: number = Date.now()): void => {
  try {
    const utilization = finite(info.utilization);
    const resetsAt = finite(info.resetsAt);
    if (utilization === undefined || resetsAt === undefined) return;
    const current = readJson(engineFile());
    const merged = isRecord(current) ? current : {};
    const entry: EngineLimitEntry = {
      utilization: Math.min(100, Math.max(0, Math.round(utilization * 10_000) / 100)),
      resetsAt: toMillis(resetsAt),
      status: info.status,
      at: now,
    };
    writeAtomic(engineFile(), { ...merged, [info.rateLimitType ?? "unknown"]: entry });
  } catch {
    return;
  }
};

const newest = (candidates: (LimitWindow | undefined)[], now: number): LimitWindow | undefined =>
  candidates
    .filter((candidate): candidate is LimitWindow => candidate !== undefined && candidate.resetsAt > now)
    .sort((left, right) => right.at - left.at)[0];

const fromStatusline = (raw: unknown, key: string): LimitWindow | undefined => {
  if (!isRecord(raw) || !isRecord(raw.rate_limits)) return undefined;
  const window = raw.rate_limits[key];
  const at = finite(raw.at);
  if (!isRecord(window) || at === undefined) return undefined;
  const pct = finite(window.used_percentage);
  const resetsAt = finite(window.resets_at);
  if (pct === undefined || resetsAt === undefined) return undefined;
  return { pct, resetsAt: toMillis(resetsAt), at, source: "statusline" };
};

const fromEngine = (raw: unknown, key: string): LimitWindow | undefined => {
  if (!isRecord(raw)) return undefined;
  const entry = raw[key];
  if (!isRecord(entry)) return undefined;
  const pct = finite(entry.utilization);
  const resetsAt = finite(entry.resetsAt);
  const at = finite(entry.at);
  if (pct === undefined || resetsAt === undefined || at === undefined) return undefined;
  return { pct, resetsAt, at, source: "engine" };
};

const MODEL_WINDOWS: { key: string; model: string }[] = [
  { key: "seven_day_opus", model: "Opus" },
  { key: "seven_day_sonnet", model: "Sonnet" },
];

export const readLimits = (now: number = Date.now()): PlanLimits => {
  const statusline = readJson(statuslineFile());
  const engine = readJson(engineFile());
  const session = newest([fromStatusline(statusline, "five_hour"), fromEngine(engine, "five_hour")], now);
  const weekly = newest([fromStatusline(statusline, "seven_day"), fromEngine(engine, "seven_day")], now);
  const weeklyByModel = MODEL_WINDOWS.flatMap(({ key, model }): ModelLimit[] => {
    const window = newest([fromEngine(engine, key)], now);
    return window ? [{ ...window, model }] : [];
  });
  return {
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    weeklyByModel,
    installCommand: installCommand(),
  };
};
