import type { Alerts } from "./alerts.ts";
import { burnTitle, stuckTitle } from "./alert-title.ts";
import type { Store } from "./store.ts";
import {
  burnRate,
  evaluateBurn,
  evaluateStuck,
  isRunningBash,
  normalRate,
  type HaltReason,
  type Sample,
  type WorkerRow,
} from "./telemetry.ts";
import { THRESHOLDS, type Thresholds } from "./thresholds.ts";

export type WatchdogDeps = {
  store: Store;
  alerts: Alerts;
  ticket: string;
  runId: string;
  now: () => number;
  halt: (workerId: string, reason: HaltReason) => void;
  thresholds?: Thresholds;
};

type WorkerWatch = {
  over3Since?: number;
  stuckAlertedAt?: number;
};

const samplesByWorker = (samples: Sample[]): Map<string, { atMs: number; tokens: number }[]> => {
  const grouped = new Map<string, { atMs: number; tokens: number }[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.workerId) ?? [];
    list.push({ atMs: Date.parse(sample.at), tokens: sample.tokens });
    grouped.set(sample.workerId, list);
  }
  return grouped;
};

export class Watchdog {
  private readonly deps: WatchdogDeps;
  private readonly thresholds: Thresholds;
  private readonly watch = new Map<string, WorkerWatch>();
  private timer: NodeJS.Timeout | undefined;

  constructor(deps: WatchdogDeps) {
    this.deps = deps;
    this.thresholds = deps.thresholds ?? THRESHOLDS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.thresholds.watchdogMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(): void {
    const nowMs = this.deps.now();
    const live = this.deps.store
      .liveWorkers(this.deps.ticket)
      .filter((worker) => worker.runId === this.deps.runId && worker.role !== "lead");
    if (live.length === 0) return;
    const since = new Date(nowMs - this.thresholds.burnWindowMs).toISOString();
    const grouped = samplesByWorker(this.deps.store.samples(this.deps.ticket, since));
    for (const worker of live) {
      const watch = this.watch.get(worker.id) ?? {};
      this.watch.set(worker.id, watch);
      const stopped = this.checkBurn(worker, watch, grouped.get(worker.id) ?? [], nowMs);
      if (!stopped) this.checkStuck(worker, watch, nowMs);
    }
  }

  private checkBurn(
    worker: WorkerRow,
    watch: WorkerWatch,
    samples: { atMs: number; tokens: number }[],
    nowMs: number,
  ): boolean {
    const rate = burnRate(samples, nowMs, this.thresholds);
    const normal = normalRate(this.deps.store.finishedRates(worker.role), worker.role, this.thresholds);
    const verdict = evaluateBurn({ rate, normal, over3Since: watch.over3Since, nowMs }, this.thresholds);
    watch.over3Since = verdict.over3Since;
    if (verdict.level >= 2 && rate !== undefined) {
      this.deps.alerts.raise(
        "burn",
        `${worker.label} burns ${Math.round(rate / 1000)}k tokens/min, ${verdict.level}x or more above the normal ${Math.round(normal / 1000)}k`,
        {
          workerId: worker.id,
          step: worker.step,
          title: burnTitle({ role: worker.role, step: worker.step, level: verdict.level, rate }),
          dedupeKey: `${worker.id}:burn:${verdict.level}`,
        },
      );
    }
    if (!verdict.stop) return false;
    this.deps.halt(worker.id, "burn rate");
    return true;
  }

  private checkStuck(worker: WorkerRow, watch: WorkerWatch, nowMs: number): void {
    const verdict = evaluateStuck(
      {
        state: worker.state,
        action: worker.action,
        lastActivityMs: Date.parse(worker.lastActivityAt),
        alertedAtMs: watch.stuckAlertedAt,
        nowMs,
      },
      this.thresholds,
    );
    const afterMs = isRunningBash(worker.state, worker.action)
      ? this.thresholds.bashStuckAfterMs
      : this.thresholds.stuckAfterMs;
    if (verdict.reset) watch.stuckAlertedAt = undefined;
    if (verdict.alert) {
      watch.stuckAlertedAt = nowMs;
      this.deps.alerts.raise(
        "stuck",
        `${worker.label} made no tool call and no file change for ${Math.round(afterMs / 60_000)} minutes`,
        {
          workerId: worker.id,
          step: worker.step,
          title: stuckTitle({ role: worker.role, step: worker.step, minutes: Math.round(afterMs / 60_000) }),
          dedupeKey: `${worker.id}:stuck`,
        },
      );
    }
    if (verdict.stop) this.deps.halt(worker.id, "stuck");
  }
}
