import fs from "node:fs";
import path from "node:path";
import type { Escalation, EscalationLevel, Phase } from "./types.ts";
import { ESCALATION_ORDER } from "./types.ts";
import type { Scratchpad } from "./scratchpad.ts";

export const RETRY_PROMOTION_THRESHOLD = 3;

export type EscalationHandlers = {
  askOrchestrator: (question: string, context: string, from: string) => Promise<string>;
  askHuman: (question: string, context: string, from: string) => Promise<string>;
};

export class EscalationRegistry {
  private readonly open = new Map<string, Escalation>();
  private readonly all: Escalation[] = [];
  private readonly repeatKeys = new Map<string, number>();
  private counter = 0;

  private readonly scratchpad: Scratchpad;
  private readonly runDir: string;
  private readonly handlers: EscalationHandlers;

  constructor(
    scratchpad: Scratchpad,
    runDir: string,
    handlers: EscalationHandlers,
  ) {
    this.scratchpad = scratchpad;
    this.runDir = runDir;
    this.handlers = handlers;
  }

  private nextId(): string {
    return `E${String(++this.counter).padStart(3, "0")}`;
  }

  countRepeat(key: string): number {
    const next = (this.repeatKeys.get(key) ?? 0) + 1;
    this.repeatKeys.set(key, next);
    return next;
  }

  private promote(level: EscalationLevel, attempts: number): EscalationLevel {
    if (level !== "retry") return level;
    if (attempts < RETRY_PROMOTION_THRESHOLD) return "retry";
    return "orchestrator";
  }

  async raise(input: {
    from: string;
    phase: Phase | "run";
    level: EscalationLevel;
    summary: string;
    detail?: string;
    blocker?: string;
    repeatKey?: string;
    context?: string;
  }): Promise<Escalation> {
    const attempts = input.repeatKey ? this.countRepeat(input.repeatKey) : 1;
    const level = this.promote(input.level, attempts);

    const escalation: Escalation = {
      id: this.nextId(),
      at: new Date().toISOString(),
      from: input.from,
      phase: input.phase,
      level,
      summary: input.summary,
      detail: input.detail,
      blocker: input.blocker,
      attempts,
    };
    this.open.set(escalation.id, escalation);
    this.all.push(escalation);

    this.scratchpad.record(
      input.from,
      input.phase,
      "escalation",
      `[${escalation.id}] ${level.toUpperCase()} — ${input.summary}`,
      {
        id: escalation.id,
        level,
        attempts,
        detail: input.detail,
        blocker: input.blocker,
        promotedFrom: level === input.level ? undefined : input.level,
      },
    );

    await this.route(escalation, input.context ?? "");
    this.persist();
    return escalation;
  }

  private async route(escalation: Escalation, context: string): Promise<void> {
    if (escalation.level === "retry" || escalation.level === "repair") {
      this.resolve(
        escalation.id,
        escalation.level === "retry"
          ? `Retry authorised (attempt ${escalation.attempts} of ${RETRY_PROMOTION_THRESHOLD}). Change the approach before retrying; an identical retry will be promoted.`
          : "Repair it yourself, inside your current scope, then continue.",
        "policy",
      );
      return;
    }

    if (escalation.level === "abort") {
      return;
    }

    const question = [
      `Escalation ${escalation.id} from ${escalation.from} during phase ${escalation.phase}.`,
      `Summary: ${escalation.summary}`,
      escalation.detail ? `Detail: ${escalation.detail}` : "",
      escalation.blocker ? `Blocker: ${escalation.blocker}` : "",
      "",
      "Decide what the agent should do next. Be specific and actionable.",
    ]
      .filter(Boolean)
      .join("\n");

    const answer =
      escalation.level === "human"
        ? await this.handlers.askHuman(question, context, escalation.from)
        : await this.handlers.askOrchestrator(question, context, escalation.from);

    this.resolve(
      escalation.id,
      answer,
      escalation.level === "human" ? "human" : "orchestrator",
    );
  }

  resolve(
    id: string,
    resolution: string,
    resolvedBy: Escalation["resolvedBy"],
  ): void {
    const escalation = this.open.get(id);
    if (!escalation) return;
    escalation.resolvedAt = new Date().toISOString();
    escalation.resolution = resolution;
    escalation.resolvedBy = resolvedBy;
    this.open.delete(id);
    this.scratchpad.record(
      escalation.from,
      escalation.phase,
      "resolution",
      `[${id}] resolved by ${resolvedBy} — ${resolution}`,
      { id, resolvedBy },
    );
    this.persist();
  }

  resolutionFor(id: string): string | undefined {
    return this.all.find((e) => e.id === id)?.resolution;
  }

  openIds(): string[] {
    return [...this.open.keys()];
  }

  records(): Escalation[] {
    return [...this.all];
  }

  aborts(): Escalation[] {
    return this.all.filter((e) => e.level === "abort");
  }

  forPhase(phase: Phase | "run"): Escalation[] {
    return this.all.filter((e) => e.phase === phase);
  }

  isMoreSevere(a: EscalationLevel, b: EscalationLevel): boolean {
    return ESCALATION_ORDER.indexOf(a) > ESCALATION_ORDER.indexOf(b);
  }

  persist(): void {
    fs.writeFileSync(
      path.join(this.runDir, "escalations.json"),
      JSON.stringify(this.all, null, 2),
    );
  }
}
