import { line } from "./console.ts";

export type CycleUsage = {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

export type SpendTotals = CycleUsage & {
  cycles: number;
};

export const EMPTY_USAGE: CycleUsage = {
  outputTokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
};

export const EMPTY_TOTALS: SpendTotals = { ...EMPTY_USAGE, cycles: 0 };

const tokens = new Intl.NumberFormat("en-US");

export const addUsage = (
  totals: SpendTotals,
  usage: CycleUsage,
  cycle: number,
  resumed: boolean
): SpendTotals => ({
  outputTokens: totals.outputTokens + usage.outputTokens,
  inputTokens: totals.inputTokens + usage.inputTokens,
  cacheReadTokens: totals.cacheReadTokens + usage.cacheReadTokens,
  costUsd: resumed
    ? Math.max(totals.costUsd, usage.costUsd)
    : totals.costUsd + usage.costUsd,
  cycles: cycle,
});

export const elapsedText = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
};

export type SpendReadout = {
  cycle: number;
  usage: CycleUsage;
  cycleMs: number;
  totals: SpendTotals;
  elapsedMs: number;
};

export const printSpend = ({
  cycle,
  usage,
  cycleMs,
  totals,
  elapsedMs,
}: SpendReadout): void => {
  line(
    `Cycle ${cycle}   output ${tokens.format(
      usage.outputTokens
    )} tok   cost ${usage.costUsd.toFixed(4)} USD   ${elapsedText(cycleMs)}`
  );
  line(
    `Cumulative   output ${tokens.format(
      totals.outputTokens
    )} tok   input ${tokens.format(
      totals.inputTokens
    )} tok   cache read ${tokens.format(totals.cacheReadTokens)} tok`
  );
  line(
    `             cost ${totals.costUsd.toFixed(4)} USD   elapsed ${elapsedText(
      elapsedMs
    )}   cycles ${totals.cycles}`
  );
};
