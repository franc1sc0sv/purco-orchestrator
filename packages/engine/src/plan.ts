import path from "node:path";
import type { Store } from "./store.ts";
import type { Phase } from "./types.ts";

export type Step = {
  phase: Phase;
  cluster?: string;
  rows?: number;
  writers?: number;
  brief?: string;
  fix?: string;
  notes?: string;
  attempt?: number;
  human?: boolean;
};

export const CLUSTERED_PHASES: Phase[] = ["survey"];

export const planSteps = (phases: Phase[], store?: Store): Step[] => {
  const steps: Step[] = [];
  for (const phase of phases) {
    if (phase === "grill") {
      steps.push({ phase }, { phase, human: true });
      continue;
    }
    if (!CLUSTERED_PHASES.includes(phase)) {
      steps.push({ phase });
      continue;
    }
    if (!store) {
      steps.push({ phase });
      continue;
    }
    const clusters = store.clustersWithWork();
    if (clusters.length === 0) {
      steps.push({ phase });
      continue;
    }
    for (const cluster of clusters) {
      steps.push({
        phase,
        cluster: cluster.cluster,
        rows: cluster.rows,
        writers: cluster.writers,
      });
    }
  }
  return steps;
};

export const briefSteps = (briefs: string[]): Step[] =>
  briefs.map((brief) => ({ phase: "build", brief }));

const briefName = (brief: string): string =>
  path.basename(brief, ".md").replace(/^04-brief-/, "");

const suffix = (step: Step): string => {
  const parts = [
    step.cluster,
    step.brief ? briefName(step.brief) : undefined,
    step.human ? "human" : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(":");
};

export const stepKey = (step: Step): string => {
  const base = suffix(step) ? `${step.phase}:${suffix(step)}` : step.phase;
  return step.attempt && step.attempt > 1 ? `${base}#${step.attempt}` : base;
};

export const describeStep = (step: Step): string => {
  const key = stepKey(step);
  return step.cluster
    ? `${key} (${step.rows} rows, ${step.writers} writers)`
    : key;
};

export const stepLabel = (role: string, step: Step): string => {
  const tail = suffix(step) || "1";
  const attempt = step.attempt && step.attempt > 1 ? `#${step.attempt}` : "";
  return `${role.toUpperCase()}-${tail}${attempt}`;
};
