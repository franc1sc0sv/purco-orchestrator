import { DOCTRINE_PATH } from "../constants.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isScope } from "test-forge-contracts/project";
import type { Scope } from "test-forge-contracts/project";

export type SeedAspect = {
  id: string;
  scope: Scope;
  title: string;
  appliesWhen: string;
  blockingBar: string;
  governs: string;
  rationale: string;
};

export type BlockingBar = {
  label: string;
  meaning: string;
  reason: string;
};

export type SeedTaxonomy = {
  blockingBars: Record<string, BlockingBar>;
  aspects: SeedAspect[];
};

const SEED_PATH = join(DOCTRINE_PATH, "taxonomy.seed.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const toAspect = (value: unknown): SeedAspect | null => {
  if (!isRecord(value)) return null;
  const scope = value["scope"];
  if (!isScope(scope)) return null;
  return {
    id: text(value["id"]),
    scope,
    title: text(value["title"]),
    appliesWhen: text(value["appliesWhen"]),
    blockingBar: text(value["blockingBar"]),
    governs: text(value["governs"]),
    rationale: text(value["rationale"]),
  };
};

const toBar = (value: unknown): BlockingBar =>
  isRecord(value)
    ? {
        label: text(value["label"]),
        meaning: text(value["meaning"]),
        reason: text(value["reason"]),
      }
    : { label: "", meaning: "", reason: "" };

const toBars = (value: unknown): Record<string, BlockingBar> => {
  if (!isRecord(value)) return {};
  const bars: Record<string, BlockingBar> = {};
  for (const [key, entry] of Object.entries(value)) bars[key] = toBar(entry);
  return bars;
};

let cache: SeedTaxonomy | null = null;

export const seedTaxonomy = (): SeedTaxonomy => {
  if (cache !== null) return cache;
  const parsed: unknown = JSON.parse(readFileSync(SEED_PATH, "utf8"));
  const source = isRecord(parsed) ? parsed : {};
  const raw = source["aspects"];
  const aspects: unknown[] = Array.isArray(raw) ? raw : [];
  cache = {
    blockingBars: toBars(source["blockingBars"]),
    aspects: aspects
      .map(toAspect)
      .filter((aspect): aspect is SeedAspect => aspect !== null),
  };
  return cache;
};

export const blockingBarNames = (): string[] =>
  Object.keys(seedTaxonomy().blockingBars);

export const isSeededAspect = (scope: Scope, aspect: string): boolean =>
  seedTaxonomy().aspects.some(
    (entry) => entry.scope === scope && entry.id === aspect
  );
