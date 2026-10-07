import type { AlertKind, StepStatus, TicketState, WorkerState } from "@/lib/types";

export type Tone =
  | "running"
  | "waiting"
  | "stuck"
  | "halted"
  | "failed"
  | "done"
  | "idle"
  | "pending"
  | "skipped"
  | "tool"
  | "burn";

export type ToneStyle = {
  soft: string;
  dot: string;
  node: string;
  borderLeft: string;
  vars: string;
  bar: string;
  color: string;
  dash: string | undefined;
  label: string | null;
};

const VARS: Record<Tone, string> = {
  running: "[--tone:var(--state-running)]",
  tool: "[--tone:var(--state-tool)]",
  burn: "[--tone:var(--state-burn)]",
  waiting: "[--tone:var(--state-waiting)]",
  done: "[--tone:var(--state-done)]",
  idle: "[--tone:var(--state-idle)]",
  pending: "[--tone:var(--state-pending)]",
  skipped: "[--tone:var(--state-skipped)]",
  stuck: "[--tone:var(--state-stuck)]",
  halted: "[--tone:var(--state-halted)]",
  failed: "[--tone:var(--state-failed)]",
};

const make = (tone: Tone, style: Omit<ToneStyle, "vars" | "color">): ToneStyle => ({
  ...style,
  vars: VARS[tone],
  color: `var(--state-${tone})`,
});

const solid = (tone: Tone): ToneStyle =>
  make(tone, {
    soft: "border-(--tone) bg-(--tone) text-primary-foreground",
    dot: "bg-primary-foreground",
    node: "border-(--tone) bg-(--tone)/20",
    borderLeft: "border-l-(--tone)",
    bar: "bg-(--tone)/20 [&>[data-slot=progress-indicator]]:bg-(--tone)",
    dash: undefined,
    label: null,
  });

const outlined = (tone: Tone): ToneStyle =>
  make(tone, {
    soft: "border-(--tone) bg-transparent text-(--tone)",
    dot: "border-2 border-(--tone) bg-transparent",
    node: "border-(--tone) bg-transparent",
    borderLeft: "border-l-(--tone)",
    bar: "bg-(--blue-2)/30 [&>[data-slot=progress-indicator]]:bg-(--blue-2)",
    dash: undefined,
    label: null,
  });

const muted = (tone: Tone): ToneStyle =>
  make(tone, {
    soft: "border-transparent bg-(--tone)/25 text-foreground",
    dot: "bg-(--tone)",
    node: "border-(--tone) bg-(--tone)/10",
    borderLeft: "border-l-(--tone)",
    bar: "bg-(--blue-3)/20 [&>[data-slot=progress-indicator]]:bg-(--blue-3)",
    dash: undefined,
    label: null,
  });

const neutral = (tone: Tone): ToneStyle =>
  make(tone, {
    soft: "border-transparent bg-(--tone)/20 text-muted-foreground",
    dot: "bg-(--tone)",
    node: "border-(--tone) bg-transparent",
    borderLeft: "border-l-(--tone)",
    bar: "bg-(--tone)/20 [&>[data-slot=progress-indicator]]:bg-(--tone)",
    dash: undefined,
    label: null,
  });

const flagged = (tone: Tone, label: string): ToneStyle =>
  make(tone, {
    soft: "border-dashed border-(--tone) bg-(--tone)/20 text-(--tone)",
    dot: "border-2 border-dashed border-(--tone) bg-transparent",
    node: "border-dashed border-(--tone) bg-(--tone)/15",
    borderLeft: "border-dashed border-l-(--tone)",
    bar: "bg-(--tone)/20 [&>[data-slot=progress-indicator]]:bg-(--tone)",
    dash: "6 4",
    label,
  });

export const TONES: Record<Tone, ToneStyle> = {
  running: solid("running"),
  tool: solid("tool"),
  burn: solid("burn"),
  waiting: outlined("waiting"),
  done: muted("done"),
  idle: neutral("idle"),
  pending: { ...neutral("pending"), dash: "2 4" },
  skipped: neutral("skipped"),
  stuck: flagged("stuck", "STUCK"),
  halted: flagged("halted", "HALTED"),
  failed: flagged("failed", "FAILED"),
};

export const STATE_TONE: Record<TicketState, Tone> = {
  running: "running",
  waiting: "waiting",
  stuck: "stuck",
  halted: "halted",
  failed: "failed",
  done: "done",
  idle: "idle",
};

export const STEP_TONE: Record<StepStatus, Tone> = {
  pending: "pending",
  running: "running",
  waiting: "waiting",
  halted: "halted",
  failed: "failed",
  done: "done",
  skipped: "skipped",
};

export const WORKER_TONE: Record<WorkerState, Tone> = {
  starting: "running",
  thinking: "running",
  tool: "tool",
  "waiting-human": "waiting",
  "waiting-lead": "waiting",
  done: "done",
  failed: "failed",
  halted: "halted",
};

export const ALERT_TONE: Record<AlertKind, Tone> = {
  gate: "waiting",
  question: "waiting",
  sign: "waiting",
  stuck: "stuck",
  loop: "stuck",
  burn: "burn",
  halted: "halted",
  done: "done",
};

export const STATE_LABEL: Record<TicketState, string> = {
  running: "running",
  waiting: "waiting",
  stuck: "stuck",
  halted: "halted",
  failed: "failed",
  done: "done",
  idle: "idle",
};

export const WORKER_LABEL: Record<WorkerState, string> = {
  starting: "starting",
  thinking: "thinking",
  tool: "tool",
  "waiting-human": "waiting for you",
  "waiting-lead": "waiting for lead",
  done: "done",
  failed: "failed",
  halted: "halted",
};

export const isWorkerLive = (state: WorkerState): boolean =>
  state !== "done" && state !== "failed" && state !== "halted";

export const isWorkerBusy = (state: WorkerState): boolean =>
  state === "starting" || state === "thinking" || state === "tool";
