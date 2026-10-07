import { z } from "zod";
import { OUTCOME_KINDS, type StepResult } from "./types.ts";

export const FindingSchema = z.object({
  title: z.string().min(1),
  severity: z.string().min(1),
  location: z.string().min(1),
});

export const HandoffSchema = z.object({
  status: z.enum(OUTCOME_KINDS),
  summary: z.string().min(1),
  output_path: z.string().min(1).optional(),
  produced: z.array(z.string().min(1)).optional(),
  open_questions: z.number().int().min(0).optional(),
  evidence: z.string().min(1).optional(),
  counts: z.record(z.string(), z.number()).optional(),
  findings: z.array(FindingSchema).optional(),
});

export type HandoffParse =
  | { ok: true; result: StepResult }
  | { ok: false; fix: string };

const refusal = (fix: string): HandoffParse => ({ ok: false, fix });

export const parseHandoff = (raw: unknown): HandoffParse => {
  const parsed = HandoffSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "handoff"}: ${issue.message}`)
      .join("; ");
    return refusal(
      `The handoff is malformed (${issues}). Fix these fields and call handoff again. counts is an object of numbers; findings is a list of {title, severity, location}.`,
    );
  }
  const value = parsed.data;
  if (value.status !== "delivered" && !value.evidence) {
    return refusal(
      "A handoff that is not delivered needs evidence. Name the file, line or tool result, then call handoff again.",
    );
  }
  return {
    ok: true,
    result: {
      status: value.status,
      summary: value.summary,
      outputPath: value.output_path,
      produced: value.produced ?? [],
      openQuestions: value.open_questions ?? 0,
      evidence: value.evidence,
      counts: value.counts,
      findings: value.findings,
    },
  };
};
