import type { Store } from "./store.ts";
import type { Phase } from "./types.ts";

export type Step = {
  phase: Phase;
  cluster?: string;
  rows?: number;
  writers?: number;
};

export const CLUSTERED_PHASES: Phase[] = ["survey"];

export const planSteps = (phases: Phase[], store?: Store): Step[] => {
  const steps: Step[] = [];
  for (const phase of phases) {
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

export const describeStep = (step: Step): string =>
  step.cluster
    ? `${step.phase}:${step.cluster} (${step.rows} rows, ${step.writers} writers)`
    : step.phase;

export const stepLabel = (role: string, step: Step): string =>
  step.cluster
    ? `${role.toUpperCase()}-${step.cluster}`
    : `${role.toUpperCase()}-1`;
