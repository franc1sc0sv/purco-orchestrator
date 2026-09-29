import type { Scratchpad } from "./scratchpad.ts";
import type { Phase } from "./types.ts";

export type AgentSession = {
  label: string;
  agentId: string;
  agentType: string;
  phase: Phase | "run";
  startedAt: string;
  endedAt?: string;
  transcriptPath?: string;
  toolCalls: number;
  failures: number;
};

export const ORCHESTRATOR_LABEL = "ORCHESTRATOR";

export class SubagentTracker {
  private readonly byAgentId = new Map<string, AgentSession>();
  private readonly byToolUseId = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  private contextAgentId: string | undefined;
  private phase: Phase | "run" = "run";
  private mainLabel: string = ORCHESTRATOR_LABEL;

  private readonly scratchpad: Scratchpad;

  constructor(scratchpad: Scratchpad) {
    this.scratchpad = scratchpad;
  }

  setPhase(phase: Phase | "run"): void {
    this.phase = phase;
  }

  currentPhase(): Phase | "run" {
    return this.phase;
  }

  private mint(agentType: string): string {
    const next = (this.counters.get(agentType) ?? 0) + 1;
    this.counters.set(agentType, next);
    return `${agentType.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${next}`;
  }

  start(input: {
    agentId: string;
    agentType: string;
    transcriptPath?: string;
  }): AgentSession {
    const existing = this.byAgentId.get(input.agentId);
    if (existing) return existing;
    const session: AgentSession = {
      label: this.mint(input.agentType),
      agentId: input.agentId,
      agentType: input.agentType,
      phase: this.phase,
      startedAt: new Date().toISOString(),
      transcriptPath: input.transcriptPath,
      toolCalls: 0,
      failures: 0,
    };
    this.byAgentId.set(input.agentId, session);
    this.contextAgentId = input.agentId;
    this.scratchpad.record(
      session.label,
      this.phase,
      "spawn",
      `${input.agentType} started as ${session.label}`,
      { agentId: input.agentId, transcriptPath: input.transcriptPath },
    );
    return session;
  }

  stop(agentId: string, lastMessage?: string): AgentSession | undefined {
    const session = this.byAgentId.get(agentId);
    if (!session) return undefined;
    session.endedAt = new Date().toISOString();
    this.scratchpad.record(
      session.label,
      session.phase,
      "phase_end",
      `${session.label} stopped after ${session.toolCalls} tool calls, ${session.failures} failures`,
      { lastMessage: lastMessage?.slice(0, 600) },
    );
    if (this.contextAgentId === agentId) this.contextAgentId = undefined;
    return session;
  }

  bindToolUse(toolUseId: string | undefined, agentId?: string): void {
    if (!toolUseId) return;
    const resolved = agentId ?? this.contextAgentId;
    if (resolved) this.byToolUseId.set(toolUseId, resolved);
  }

  setContextFromMessage(parentToolUseId: string | null | undefined): void {
    if (!parentToolUseId) {
      this.contextAgentId = undefined;
      return;
    }
    const agentId = this.byToolUseId.get(parentToolUseId);
    if (agentId) this.contextAgentId = agentId;
  }

  setMainLabel(label: string): void {
    this.mainLabel = label;
  }

  labelFor(agentId: string | undefined): string {
    if (!agentId) return this.mainLabel;
    return this.byAgentId.get(agentId)?.label ?? this.mainLabel;
  }

  active(): string {
    return this.labelFor(this.contextAgentId);
  }

  activeSession(): AgentSession | undefined {
    if (!this.contextAgentId) return undefined;
    return this.byAgentId.get(this.contextAgentId);
  }

  countToolCall(): void {
    const session = this.activeSession();
    if (session) session.toolCalls += 1;
  }

  countFailure(): void {
    const session = this.activeSession();
    if (session) session.failures += 1;
  }

  sessions(): AgentSession[] {
    return [...this.byAgentId.values()];
  }
}
