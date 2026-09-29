import fs from "node:fs";
import path from "node:path";
import type { Phase, RoleName } from "./types.ts";
import type { Scratchpad } from "./scratchpad.ts";
import { ORCHESTRATOR_LABEL } from "./tracker.ts";

export type BusMessage = {
  id: string;
  at: string;
  from: string;
  to: typeof ORCHESTRATOR_LABEL;
  forRole?: RoleName;
  subject: string;
  body: string;
  relayedAt?: string;
  relayedTo?: string;
  readAt?: string;
};

export class MessageBus {
  private readonly messages: BusMessage[] = [];
  private counter = 0;
  private readonly scratchpad: Scratchpad;
  private readonly runDir: string;

  constructor(scratchpad: Scratchpad, runDir: string) {
    this.scratchpad = scratchpad;
    this.runDir = runDir;
  }

  report(input: {
    from: string;
    subject: string;
    body: string;
    forRole?: RoleName;
    phase: Phase | "run";
  }): BusMessage {
    const message: BusMessage = {
      id: `M${String(++this.counter).padStart(3, "0")}`,
      at: new Date().toISOString(),
      from: input.from,
      to: ORCHESTRATOR_LABEL,
      forRole: input.forRole,
      subject: input.subject,
      body: input.body,
    };
    this.messages.push(message);
    this.scratchpad.record(
      input.from,
      input.phase,
      "message",
      input.forRole
        ? `-> ORCHESTRATOR (relay to ${input.forRole}): ${input.subject}`
        : `-> ORCHESTRATOR: ${input.subject}`,
      { id: message.id, forRole: input.forRole, body: input.body }
    );
    this.persist();
    return message;
  }

  pendingFor(role: RoleName): BusMessage[] {
    return this.messages.filter(
      (message) => message.forRole === role && message.relayedAt === undefined
    );
  }

  relay(
    role: RoleName,
    agentLabel: string,
    phase: Phase | "run"
  ): BusMessage[] {
    const pending = this.pendingFor(role);
    if (pending.length === 0) return [];
    const now = new Date().toISOString();
    for (const message of pending) {
      message.relayedAt = now;
      message.relayedTo = agentLabel;
    }
    this.scratchpad.record(
      ORCHESTRATOR_LABEL,
      phase,
      "message",
      `relayed ${pending.length} message(s) to ${agentLabel}`,
      { ids: pending.map((message) => message.id) }
    );
    this.persist();
    return pending;
  }

  relayedTo(agentLabel: string, markRead = true): BusMessage[] {
    const delivered = this.messages.filter(
      (message) =>
        message.relayedTo === agentLabel && message.readAt === undefined
    );
    if (markRead && delivered.length > 0) {
      const now = new Date().toISOString();
      for (const message of delivered) message.readAt = now;
      this.persist();
    }
    return delivered;
  }

  briefing(messages: BusMessage[]): string {
    if (messages.length === 0) return "";
    return messages
      .map(
        (message) =>
          `[${message.id}] from ${message.from} — ${message.subject}\n${message.body}`
      )
      .join("\n\n");
  }

  all(): BusMessage[] {
    return [...this.messages];
  }

  undeliveredCount(): number {
    return this.messages.filter((message) => message.relayedAt === undefined)
      .length;
  }

  persist(): void {
    fs.writeFileSync(
      path.join(this.runDir, "messages.json"),
      JSON.stringify(this.messages, null, 2)
    );
  }
}
