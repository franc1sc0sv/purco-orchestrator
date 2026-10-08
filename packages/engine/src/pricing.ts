import { MODELS } from "./types.ts";
import type { TokenUsage } from "./message-handler.ts";

export type Price = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

export const PRICES_PER_MILLION: Record<string, Price> = {
  [MODELS.sonnet]: { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  [MODELS.opus]: { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 },
};

export const priceFor = (model: string): Price | undefined => {
  const exact = PRICES_PER_MILLION[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICES_PER_MILLION).find((known) => model.startsWith(known));
  return prefix ? PRICES_PER_MILLION[prefix] : undefined;
};

export const priceByFamily = (model: string): Price | undefined => {
  const known = priceFor(model);
  if (known) return known;
  if (model.includes("opus")) return PRICES_PER_MILLION[MODELS.opus];
  if (model.includes("sonnet")) return PRICES_PER_MILLION[MODELS.sonnet];
  return undefined;
};

export const messageCost = (model: string, usage: TokenUsage): number => {
  const price = priceFor(model);
  if (!price) return 0;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheCreation * price.cacheWrite +
      usage.cacheRead * price.cacheRead) /
    1_000_000
  );
};
