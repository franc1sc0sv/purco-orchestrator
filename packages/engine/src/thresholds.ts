export const THRESHOLDS = {
  watchdogMs: 15_000,
  sampleMs: 10_000,
  burnWindowMs: 120_000,
  burnMinSpanMs: 30_000,
  burnAlertFactor: 2,
  burnStopFactor: 3,
  burnStopSustainMs: 120_000,
  historyMin: 3,
  stuckAfterMs: 300_000,
  stuckStopAfterAlertMs: 600_000,
  bashStuckAfterMs: 1_200_000,
  bashStuckStopAfterAlertMs: 1_200_000,
  loopRepeats: 3,
  fallbackTokensPerMin: 60_000,
  defaultTokensPerMin: {
    intake: 40_000,
    inquisitor: 60_000,
    planner: 60_000,
    builder: 90_000,
    fixer: 90_000,
    tester: 90_000,
    verifier: 60_000,
    reviewer: 60_000,
    lead: 30_000,
  } as Record<string, number>,
};

export type Thresholds = typeof THRESHOLDS;
