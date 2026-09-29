import fs from "node:fs";
import { z } from "zod";
import { Store } from "./store.ts";

const labelSchema = z.object({
  probe: z.string(),
  labelledAt: z.string().optional(),
  labelledBy: z.string().optional(),
  completeClusters: z.array(z.string()).optional(),
  note: z.string().optional(),
  labels: z.array(
    z.object({
      path: z.string(),
      axis: z.enum(["A", "B", "C", "D"]),
      state: z.enum(["no_change", "leftover", "defect", "keeps_account"]),
      why: z.string(),
    }),
  ),
});

export type EvalOutcome = {
  total: number;
  agreed: number;
  disagreed: {
    path: string;
    axis: string;
    expected: string;
    actual: string;
    why: string;
  }[];
  unjudged: { path: string; axis: string }[];
  missing: { path: string; axis: string }[];
};

export const scoreRun = (
  dbPath: string,
  runId: string,
  labelsPath: string,
): EvalOutcome => {
  const raw: unknown = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
  const parsed = labelSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`labels are invalid:\n${z.prettifyError(parsed.error)}`);
  }

  const store = new Store(dbPath, runId);
  const outcome: EvalOutcome = {
    total: parsed.data.labels.length,
    agreed: 0,
    disagreed: [],
    unjudged: [],
    missing: [],
  };

  for (const label of parsed.data.labels) {
    const site = store.siteByPathAndAxis(label.path, label.axis);
    if (!site) {
      outcome.missing.push({ path: label.path, axis: label.axis });
      continue;
    }
    if (site.state === "untriaged") {
      outcome.unjudged.push({ path: label.path, axis: label.axis });
      continue;
    }
    if (site.state === label.state) {
      outcome.agreed += 1;
      continue;
    }
    outcome.disagreed.push({
      path: label.path,
      axis: label.axis,
      expected: label.state,
      actual: site.state ?? "unknown",
      why: label.why,
    });
  }

  store.close();
  return outcome;
};

export const formatOutcome = (outcome: EvalOutcome): string => {
  const judged = outcome.agreed + outcome.disagreed.length;
  const rate = judged === 0 ? 0 : Math.round((outcome.agreed / judged) * 100);
  const lines = [
    `EVAL  ${outcome.total} labelled sites`,
    "",
    `judged      ${judged}`,
    `agreed      ${outcome.agreed}`,
    `disagreed   ${outcome.disagreed.length}`,
    `unjudged    ${outcome.unjudged.length}`,
    `missing     ${outcome.missing.length}`,
    "",
    `agreement   ${rate}% of judged sites`,
  ];

  if (outcome.missing.length > 0) {
    lines.push(
      "",
      "MISSING FROM THE CENSUS - the probe no longer produces these rows,",
      "so either the probe changed or the label is stale:",
    );
    for (const row of outcome.missing) lines.push(`  ${row.axis}  ${row.path}`);
  }

  if (outcome.unjudged.length > 0) {
    lines.push("", "NOT JUDGED - the surveyor left these untriaged:");
    for (const row of outcome.unjudged)
      lines.push(`  ${row.axis}  ${row.path}`);
  }

  if (outcome.disagreed.length > 0) {
    lines.push("", "DISAGREEMENTS:");
    for (const row of outcome.disagreed) {
      lines.push(
        `  ${row.axis}  ${row.path}`,
        `      expected ${row.expected}, got ${row.actual}`,
        `      label reason: ${row.why}`,
      );
    }
  }

  lines.push(
    "",
    outcome.unjudged.length > 0
      ? "VERDICT  incomplete - the gate should have refused this run"
      : outcome.disagreed.length === 0
        ? "VERDICT  clean on the labelled set"
        : "VERDICT  disagreements above need a human to settle which side is right",
  );

  return lines.join("\n");
};
