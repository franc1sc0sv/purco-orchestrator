import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLimits, type PlanLimits } from "./limits.ts";
import { priceByFamily } from "./pricing.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BLOCK_MS = 5 * HOUR_MS;
const BURN_WINDOW_MS = 15 * 60 * 1000;
const SERIES_BUCKET_MS = 5 * 60 * 1000;
const KEEP_MS = 8 * DAY_MS;
const SYNTHETIC_MODEL = "<synthetic>";

const PROJECTS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");

export type UsageEntry = {
  key: string | null;
  at: number;
  model: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

export type UsageTotals = {
  tokens: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  costUsd: number;
  messages: number;
};

export type ModelUsage = { model: string; tokens: number; costUsd: number };

export type DayUsage = { date: string; tokens: number; costUsd: number };

export type BlockPoint = { at: string; tokens: number };

export type UsageBlock = {
  startedAt: string;
  endsAt: string;
  resetsInMs: number;
  elapsedFraction: number;
  totals: UsageTotals;
  burnTokensPerMin: number;
  projectedTokens: number;
  series: BlockPoint[];
  models: ModelUsage[];
};

export type UsageSnapshot = {
  ready: boolean;
  generatedAt: string;
  block: UsageBlock | null;
  rolling: UsageTotals;
  calendar: UsageTotals;
  days: DayUsage[];
  models: ModelUsage[];
  limits: PlanLimits;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const entryFromLine = (line: string): UsageEntry | undefined => {
  if (!line.includes('"usage"')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.message)) return undefined;
  const { message } = parsed;
  const usage = message.usage;
  if (!isRecord(usage) || typeof message.model !== "string" || message.model === SYNTHETIC_MODEL) {
    return undefined;
  }
  const at = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
  if (Number.isNaN(at)) return undefined;
  const entry: UsageEntry = {
    key:
      typeof message.id === "string" && typeof parsed.requestId === "string"
        ? `${message.id}:${parsed.requestId}`
        : null,
    at,
    model: message.model,
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
  };
  return entry.input + entry.output + entry.cacheWrite + entry.cacheRead === 0 ? undefined : entry;
};

export const dedupe = (entries: readonly UsageEntry[]): UsageEntry[] => {
  const seen = new Set<string>();
  const unique: UsageEntry[] = [];
  for (const entry of entries) {
    if (entry.key !== null) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
    }
    unique.push(entry);
  }
  return unique.sort((left, right) => left.at - right.at);
};

const costOf = (entry: UsageEntry): number => {
  const price = priceByFamily(entry.model);
  if (!price) return 0;
  return (
    (entry.input * price.input +
      entry.output * price.output +
      entry.cacheWrite * price.cacheWrite +
      entry.cacheRead * price.cacheRead) /
    1_000_000
  );
};

const emptyTotals = (): UsageTotals => ({
  tokens: 0,
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  costUsd: 0,
  messages: 0,
});

const totalsOf = (entries: readonly UsageEntry[]): UsageTotals => {
  const totals = emptyTotals();
  for (const entry of entries) {
    totals.input += entry.input;
    totals.output += entry.output;
    totals.cacheWrite += entry.cacheWrite;
    totals.cacheRead += entry.cacheRead;
    totals.costUsd += costOf(entry);
    totals.messages += 1;
  }
  totals.tokens = totals.input + totals.output + totals.cacheWrite;
  return totals;
};

const tokensOf = (entry: UsageEntry): number => entry.input + entry.output + entry.cacheWrite;

const modelsOf = (entries: readonly UsageEntry[]): ModelUsage[] => {
  const byModel = new Map<string, ModelUsage>();
  for (const entry of entries) {
    const current = byModel.get(entry.model) ?? { model: entry.model, tokens: 0, costUsd: 0 };
    byModel.set(entry.model, {
      model: entry.model,
      tokens: current.tokens + tokensOf(entry),
      costUsd: current.costUsd + costOf(entry),
    });
  }
  return [...byModel.values()].sort((left, right) => right.costUsd - left.costUsd || right.tokens - left.tokens);
};

const floorToHour = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS;

export const blocksOf = (entries: readonly UsageEntry[]): UsageEntry[][] => {
  const blocks: UsageEntry[][] = [];
  let start = 0;
  let last = 0;
  for (const entry of entries) {
    const first = blocks.length === 0 || entry.at - start >= BLOCK_MS || entry.at - last >= BLOCK_MS;
    if (first) {
      blocks.push([]);
      start = floorToHour(entry.at);
    }
    blocks[blocks.length - 1]?.push(entry);
    last = entry.at;
  }
  return blocks;
};

const activeBlock = (entries: readonly UsageEntry[], now: number): UsageBlock | null => {
  const latest = blocksOf(entries).pop();
  const first = latest?.[0];
  const last = latest?.[latest.length - 1];
  if (!latest || !first || !last) return null;
  const startedAt = floorToHour(first.at);
  const endsAt = startedAt + BLOCK_MS;
  if (now >= endsAt || now - last.at >= BLOCK_MS) return null;
  const totals = totalsOf(latest);
  const recent = latest.filter((entry) => entry.at > now - BURN_WINDOW_MS);
  const burn = recent.reduce((sum, entry) => sum + tokensOf(entry), 0) / (BURN_WINDOW_MS / 60_000);
  const remainingMin = Math.max(0, endsAt - now) / 60_000;
  const buckets = Math.ceil((Math.min(now, endsAt) - startedAt) / SERIES_BUCKET_MS);
  let running = 0;
  const series = Array.from({ length: buckets + 1 }, (_, index): BlockPoint => {
    const from = startedAt + index * SERIES_BUCKET_MS;
    running += latest
      .filter((entry) => entry.at >= from && entry.at < from + SERIES_BUCKET_MS)
      .reduce((sum, entry) => sum + tokensOf(entry), 0);
    return { at: new Date(from).toISOString(), tokens: running };
  });
  return {
    startedAt: new Date(startedAt).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    resetsInMs: Math.max(0, endsAt - now),
    elapsedFraction: Math.min(1, (now - startedAt) / BLOCK_MS),
    totals,
    burnTokensPerMin: burn,
    projectedTokens: totals.tokens + burn * remainingMin,
    series,
    models: modelsOf(latest),
  };
};

const startOfLocalDay = (at: number): number => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const localDate = (at: number): string => {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const startOfLocalWeek = (at: number): number => {
  const date = new Date(startOfLocalDay(at));
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
};

export const summarize = (entries: readonly UsageEntry[], now: number, ready: boolean): UsageSnapshot => {
  const unique = dedupe(entries);
  const rollingFrom = now - 7 * DAY_MS;
  const rolling = unique.filter((entry) => entry.at > rollingFrom);
  const calendar = unique.filter((entry) => entry.at >= startOfLocalWeek(now));
  const today = startOfLocalDay(now);
  const days = Array.from({ length: 7 }, (_, index): DayUsage => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    const from = date.getTime();
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const totals = totalsOf(unique.filter((entry) => entry.at >= from && entry.at < next.getTime()));
    return { date: localDate(from), tokens: totals.tokens, costUsd: totals.costUsd };
  });
  return {
    ready,
    generatedAt: new Date(now).toISOString(),
    block: activeBlock(unique, now),
    rolling: totalsOf(rolling),
    calendar: totalsOf(calendar),
    days,
    models: modelsOf(rolling),
    limits: readLimits(now),
  };
};

type FileState = { size: number; mtimeMs: number; offset: number; entries: UsageEntry[] };

const listJsonl = (dir: string, cutoffMs: number): { file: string; size: number; mtimeMs: number }[] => {
  const found: { file: string; size: number; mtimeMs: number }[] = [];
  const walk = (current: string): void => {
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.isFile() || !name.name.endsWith(".jsonl")) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= cutoffMs) found.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        continue;
      }
    }
  };
  walk(dir);
  return found;
};

const readNew = async (file: string, from: number, size: number): Promise<{ entries: UsageEntry[]; offset: number }> => {
  const handle = await fs.promises.open(file, "r");
  try {
    const buffer = Buffer.alloc(size - from);
    await handle.read(buffer, 0, buffer.length, from);
    const end = buffer.lastIndexOf(10) + 1;
    const entries = buffer
      .subarray(0, end)
      .toString("utf8")
      .split("\n")
      .map(entryFromLine)
      .filter((entry): entry is UsageEntry => entry !== undefined);
    return { entries, offset: from + end };
  } finally {
    await handle.close();
  }
};

export class UsageMonitor {
  private readonly files = new Map<string, FileState>();
  private readonly dir: string;
  private current: UsageSnapshot;
  private scanning: Promise<void> | undefined;

  constructor(dir: string = PROJECTS_DIR) {
    this.dir = dir;
    this.current = summarize([], Date.now(), false);
  }

  snapshot(): UsageSnapshot {
    return { ...this.current, limits: readLimits() };
  }

  refresh(): Promise<void> {
    this.scanning ??= this.scan().finally(() => {
      this.scanning = undefined;
    });
    return this.scanning;
  }

  private allEntries(): UsageEntry[] {
    const cutoff = Date.now() - KEEP_MS;
    return [...this.files.values()].flatMap((state) => state.entries).filter((entry) => entry.at >= cutoff);
  }

  private async scan(): Promise<void> {
    const listed = listJsonl(this.dir, Date.now() - KEEP_MS);
    const present = new Set(listed.map((item) => item.file));
    for (const file of this.files.keys()) if (!present.has(file)) this.files.delete(file);
    for (const item of listed) {
      const known = this.files.get(item.file);
      if (known && known.size === item.size && known.mtimeMs === item.mtimeMs) continue;
      const restart = !known || item.size < known.offset;
      const from = restart ? 0 : (known?.offset ?? 0);
      try {
        const read = await readNew(item.file, from, item.size);
        this.files.set(item.file, {
          size: item.size,
          mtimeMs: item.mtimeMs,
          offset: read.offset,
          entries: [...(restart ? [] : (known?.entries ?? [])), ...read.entries],
        });
      } catch {
        continue;
      }
    }
    this.current = summarize(this.allEntries(), Date.now(), true);
  }
}
