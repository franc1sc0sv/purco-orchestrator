import fs from "node:fs";
import path from "node:path";
import type { Store } from "./store.ts";
import type { EventKind, Phase, ScratchpadEvent } from "./types.ts";

const KIND_GLYPH: Record<EventKind, string> = {
  run_start: "RUN",
  run_end: "RUN",
  phase_start: "PHASE",
  phase_end: "PHASE",
  spawn: "SPAWN",
  thinking: "THINK",
  text: "SAY",
  tool_use: "TOOL",
  tool_result: "OK",
  tool_error: "FAIL",
  note: "NOTE",
  question: "ASK",
  answer: "ANSWER",
  escalation: "ESCALATE",
  resolution: "RESOLVED",
  message: "MSG",
  handoff: "HANDOFF",
  permission_denied: "DENIED",
  mutant: "MUTANT",
  mutant_plan: "PLAN",
  cost: "COST",
};

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export class Scratchpad {
  private seq = 0;
  private readonly eventStream: fs.WriteStream;
  private readonly livePath: string;
  private readonly events: ScratchpadEvent[] = [];

  private readonly runId: string;
  private readonly ticket: string;
  private readonly echo: boolean;
  private readonly store?: Store;

  constructor(
    runDir: string,
    runId: string,
    ticket: string,
    echo: boolean = true,
    store?: Store,
  ) {
    this.runId = runId;
    this.ticket = ticket;
    this.echo = echo;
    this.store = store;
    fs.mkdirSync(runDir, { recursive: true });
    this.eventStream = fs.createWriteStream(path.join(runDir, "events.jsonl"), {
      flags: "a",
    });
    this.livePath = path.join(runDir, "live.md");
  }

  record(
    agent: string,
    phase: Phase | "run",
    kind: EventKind,
    summary: string,
    data?: Record<string, unknown>,
  ): ScratchpadEvent {
    const event: ScratchpadEvent = {
      seq: ++this.seq,
      at: new Date().toISOString(),
      runId: this.runId,
      ticket: this.ticket,
      agent,
      phase,
      kind,
      summary: clip(summary, 2000),
      data,
    };
    this.events.push(event);
    this.eventStream.write(`${JSON.stringify(event)}\n`);
    this.mirror(event);
    if (this.echo) process.stderr.write(this.format(event));
    return event;
  }

  private mirror(event: ScratchpadEvent): void {
    if (!this.store) return;
    try {
      this.store.recordEvent(event);
    } catch (error) {
      process.stderr.write(`store mirror failed: ${String(error)}\n`);
    }
  }

  private format(event: ScratchpadEvent): string {
    const time = event.at.slice(11, 19);
    const glyph = KIND_GLYPH[event.kind].padEnd(9);
    const who = event.agent.padEnd(14);
    return `${time} ${glyph} ${who} ${clip(event.summary, 160)}\n`;
  }

  byAgent(): Map<string, ScratchpadEvent[]> {
    const grouped = new Map<string, ScratchpadEvent[]>();
    for (const event of this.events) {
      const list = grouped.get(event.agent) ?? [];
      list.push(event);
      grouped.set(event.agent, list);
    }
    return grouped;
  }

  countsFor(agent: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.events) {
      if (event.agent !== agent) continue;
      counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    }
    return counts;
  }

  writeLive(): void {
    const lines: string[] = [
      `# Orchestrator run ${this.runId}`,
      "",
      `Ticket ${this.ticket} · ${this.events.length} events · updated ${new Date().toISOString()}`,
      "",
    ];
    for (const [agent, list] of this.byAgent()) {
      const counts = this.countsFor(agent);
      const tally = Object.entries(counts)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(" · ");
      lines.push(`## ${agent}`, "", tally, "");
      for (const event of list.slice(-40)) {
        lines.push(
          `- \`${event.at.slice(11, 19)}\` **${KIND_GLYPH[event.kind]}** ${clip(event.summary, 240)}`,
        );
      }
      lines.push("");
    }
    fs.writeFileSync(this.livePath, lines.join("\n"));
  }

  async close(): Promise<void> {
    this.writeLive();
    await new Promise<void>((resolve) => this.eventStream.end(resolve));
  }
}
