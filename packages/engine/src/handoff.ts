import { z } from "zod";
import { OUTCOME_KINDS, TICKET_KINDS, type AppliedNote, type StepResult } from "./types.ts";

export const FindingSchema = z.object({
  title: z.string().min(1),
  severity: z.string().min(1),
  location: z.string().min(1),
});

export const StorySchema = z.object({
  line: z.string().min(1),
  example: z.object({ input: z.string(), result: z.string() }).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  before: z.string().optional(),
  after: z.string().optional(),
  metrics: z
    .array(z.object({ name: z.string(), before: z.number(), after: z.number(), unit: z.string().optional() }))
    .optional(),
});

const NOTE_ID = new RegExp("^(?:N-)?(\\d+)$", "i");

export const AppliedNotesSchema = z.array(
  z.object({
    id: z.union([z.number().int(), z.string()]),
    reply: z.string().default(""),
  }),
);

const appliedNotesOf = (raw: unknown): AppliedNote[] =>
  (AppliedNotesSchema.safeParse(raw).data ?? []).flatMap((entry): AppliedNote[] => {
    const id = typeof entry.id === "number" ? entry.id : Number(NOTE_ID.exec(entry.id.trim())?.[1]);
    return Number.isInteger(id) ? [{ id, reply: entry.reply.slice(0, 500) }] : [];
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
  kind: z.enum(TICKET_KINDS).optional(),
  story: z.unknown().optional(),
  applied_notes: z.unknown().optional(),
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
      kind: value.kind,
      story: StorySchema.safeParse(value.story).data,
      appliedNotes: appliedNotesOf(value.applied_notes),
    },
  };
};
