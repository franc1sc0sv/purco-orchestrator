import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import type { Phase } from "./types.ts";

export type GateResult = {
  ok: boolean;
  reason: string;
};

const pass = (reason: string): GateResult => ({ ok: true, reason });
const block = (reason: string): GateResult => ({ ok: false, reason });

const openDecisions = (pack: string): string[] => {
  const file = path.join(pack, "03-decisions.md");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^\s*[-*]\s*\[ \]/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s*\[ \]\s*/, "").trim());
};

export const phaseGate = (
  phase: Phase,
  store: Store,
  pack: string,
): GateResult => {
  if (phase === "plan") {
    const file = path.join(pack, "03-decisions.md");
    if (!fs.existsSync(file) && store.size()?.size === "S") {
      return pass("size S: the grill is skipped, and the plan lists its assumptions");
    }
    if (!fs.existsSync(file)) {
      return block(
        `${file} does not exist; run the grill phase and settle its questions before plan`,
      );
    }
    const open = openDecisions(pack);
    return open.length === 0
      ? pass("every decision in 03-decisions.md is settled")
      : block(
          `${open.length} decisions in 03-decisions.md are still open (${open.slice(0, 3).join("; ")}); finish the grill before plan`,
        );
  }

  if (phase === "survey") {
    const total = store.totalSites();
    return total > 0
      ? pass(`${total} sites in the census`)
      : block("the census is empty; run the census phase before survey");
  }

  if (phase === "audit") {
    const untriaged = store.untriagedSites();
    if (untriaged.length === 0) return pass("every site is triaged");
    const clusters = [...new Set(untriaged.map((s) => s.cluster ?? "none"))];
    return block(
      `${untriaged.length} sites are still untriaged across ${clusters.length} clusters (${clusters.slice(0, 5).join(", ")}); survey is not finished`,
    );
  }

  if (phase === "synthesize") {
    const untriaged = store.untriagedSites().length;
    if (untriaged > 0) {
      return block(`${untriaged} sites are still untriaged`);
    }
    const awaiting = store.findingsAwaitingVerdict();
    return awaiting === 0
      ? pass("every finding carries a verdict")
      : block(`${awaiting} findings have no verdict; audit is not finished`);
  }

  return pass(`no gate defined for ${phase}`);
};

export const clusterGate = (cluster: string, store: Store): GateResult => {
  const untriaged = store.untriagedInCluster(cluster);
  if (untriaged.length === 0) return pass(`${cluster} is fully triaged`);
  const worst = untriaged
    .filter((site) => site.isWriter)
    .slice(0, 3)
    .map((site) => site.path);
  const detail =
    worst.length > 0 ? ` Write paths still open: ${worst.join(", ")}.` : "";
  return block(
    `${untriaged.length} sites in ${cluster} are still untriaged.${detail} Call triage on every one of them before you finish.`,
  );
};
