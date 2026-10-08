import { NoteComposer } from "@/components/note-composer";
import { ToneBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LANES,
  commandsOf,
  isMutating,
  shortTarget,
  toolLabel,
  type Command,
  type CommandStatus,
} from "@/lib/agent-activity";
import { postNote } from "@/lib/api";
import { WORKER_LABEL, WORKER_TONE, isWorkerBusy } from "@/lib/colors";
import { clock, formatDuration, formatTokens, shortModel } from "@/lib/format";
import { buildCells } from "@/lib/mutants";
import type { StreamEvent, TestsView, Worker } from "@/lib/types";

const WINDOW_MS = 10 * 60 * 1000;
const LOG_ROWS = 20;

const formatMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms));

const Heading = ({ children }: { children: string }) => (
  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{children}</h3>
);

const RESULT_CHIP: Record<CommandStatus, "outline" | "secondary" | "default"> = {
  running: "outline",
  ok: "secondary",
  failed: "default",
};

const resultText = (command: Command): string => {
  if (command.status === "running") return "running";
  const label = command.status === "ok" ? "ok" : "failed";
  return command.ms === null ? label : `${label} · ${formatMs(command.ms)}`;
};

const NowRunning = ({
  command,
  tests,
  events,
  now,
}: {
  command: Command | undefined;
  tests: TestsView;
  events: StreamEvent[];
  now: number;
}) => {
  const mutant = buildCells(tests, isMutating(events)).find((cell) => cell.state === "running");
  return (
    <div className="bg-primary text-primary-foreground grid gap-1 rounded-lg px-4 py-3">
      <span className="text-xs font-semibold tracking-wider uppercase opacity-80">
        {command ? `Now running · ${formatDuration(Math.max(0, now - command.at))}` : "Nothing is running"}
      </span>
      {command ? (
        <span className="font-mono text-sm break-all">
          {toolLabel(command.tool)} {command.cmd}
        </span>
      ) : null}
      {mutant ? (
        <span className="font-mono text-xs break-all opacity-90">
          Mutant #{mutant.id} · {mutant.file.split("/").pop()}:{mutant.line} · {mutant.detail.before.trim()} → {mutant.detail.after.trim()}
        </span>
      ) : null}
    </div>
  );
};

const Lanes = ({ commands, now }: { commands: Command[]; now: number }) => {
  const start = now - WINDOW_MS;
  return (
    <div className="grid gap-1.5">
      {LANES.map((lane) => (
        <div key={lane} className="flex items-center gap-2">
          <span className="text-muted-foreground w-10 shrink-0 text-xs">{lane}</span>
          <div className="bg-muted/50 relative h-4 flex-1 overflow-hidden rounded-sm">
            {commands
              .filter((command) => command.lane === lane)
              .map((command) => {
                const end = command.status === "running" ? now : command.at + (command.ms ?? 0);
                const left = Math.max(0, ((command.at - start) / WINDOW_MS) * 100);
                const width = Math.max(0.6, ((end - Math.max(command.at, start)) / WINDOW_MS) * 100);
                if (end < start) return null;
                return (
                  <span
                    key={`${command.at}-${command.tool}`}
                    className="bg-blue-4 absolute inset-y-0.5 rounded-sm"
                    style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                  />
                );
              })}
          </div>
        </div>
      ))}
      <div className="text-muted-foreground flex justify-between pl-12 text-[10px]">
        <span>10 min ago</span>
        <span>now</span>
      </div>
    </div>
  );
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="grid gap-0.5 rounded-lg border px-3 py-2">
    <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{label}</span>
    <span className="font-mono text-lg leading-tight font-semibold">{value}</span>
    <span className="text-muted-foreground truncate text-xs">{sub}</span>
  </div>
);

export const AgentPanel = ({
  worker,
  events,
  tests,
  now,
  closeHref,
}: {
  worker: Worker;
  events: StreamEvent[];
  tests: TestsView;
  now: number;
  closeHref: string;
}) => {
  const commands = commandsOf(events);
  const current = commands.filter((command) => command.status === "running").pop();
  const tokens = worker.tokensIn + worker.tokensOut + worker.cacheWrite;
  const minutes = Math.max(1 / 6, (now - Date.parse(worker.startedAt)) / 60_000);
  const tone = WORKER_TONE[worker.state];
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-lg font-semibold">{worker.role}</h2>
        <Badge variant="secondary" className="font-mono">
          {shortModel(worker.model)}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {worker.label}
        </Badge>
        <ToneBadge tone={tone} pulse={isWorkerBusy(worker.state)} className="normal-case tracking-normal">
          {WORKER_LABEL[worker.state]}
        </ToneBadge>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <a href={closeHref}>Close</a>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-5 p-4">
          <NowRunning command={current} tests={tests} events={events} now={now} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Tokens" value={formatTokens(tokens)} sub={`${formatTokens(tokens / minutes)} per min`} />
            <Stat label="Turns" value={String(worker.turns)} sub={worker.maxTurns > 0 ? `of ${worker.maxTurns}` : "no limit"} />
          </div>
          <div className="grid gap-2">
            <Heading>Last 10 minutes · tool calls</Heading>
            <Lanes commands={commands} now={now} />
          </div>
          <div className="grid gap-2">
            <Heading>Command log</Heading>
            {commands.length === 0 ? <p className="text-muted-foreground text-sm">No commands yet.</p> : null}
            <div className="grid gap-1.5">
              {commands
                .slice(-LOG_ROWS)
                .reverse()
                .map((command) => (
                  <div key={`${command.at}-${command.tool}`} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground font-mono text-xs">{clock(new Date(command.at).toISOString())}</span>
                    <span className="font-semibold">{toolLabel(command.tool)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={command.cmd}>
                      {shortTarget(command.cmd)}
                    </span>
                    <Badge variant={RESULT_CHIP[command.status]} className="shrink-0 font-mono">
                      {resultText(command)}
                    </Badge>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </ScrollArea>
      <div className="border-t p-3">
        <NoteComposer
          placeholder="Send a note to this agent…"
          onSend={(text) => postNote(worker.ticket, { text, targetAgent: worker.label })}
        />
      </div>
    </Card>
  );
};
