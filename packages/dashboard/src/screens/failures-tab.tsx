import { useState } from "react";
import { CountStat } from "@/components/count-stat";
import { NoteComposer } from "@/components/note-composer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFailures } from "@/hooks/use-failures";
import { postNote } from "@/lib/api";
import { formatCost } from "@/lib/format";
import type { FailureGroup, FailureMapStep, FailureMove, FailuresView } from "@/lib/types";
import { cn } from "@/lib/utils";

const STRIPES = "bg-[repeating-linear-gradient(45deg,var(--blue-2)_0_4px,transparent_4px_8px)]";
const MAX_STACKED_LAYERS = 2;

const isFailed = (step: FailureMapStep): boolean => step.status === "failed" || step.status === "halted";

const nameOf = (baseKey: string): { name: string; sub: string | null } => {
  const parts = baseKey.split(":");
  return { name: parts[1] ?? parts[0] ?? baseKey, sub: parts[2] ?? null };
};

const stateText = (step: FailureMapStep): string => {
  if (isFailed(step)) return step.tries > 1 ? `failed ×${step.tries}` : "failed";
  if (step.status === "done") return "done";
  if (step.status === "running" || step.status === "waiting") return step.status;
  return "not run";
};

const MapNode = ({ step }: { step: FailureMapStep }) => {
  const { name, sub } = nameOf(step.baseKey);
  const failed = isFailed(step);
  const layers = failed ? Math.min(step.tries - 1, MAX_STACKED_LAYERS) : 0;
  return (
    <div className="relative shrink-0" title={step.key}>
      {Array.from({ length: layers }, (_, index) => (
        <div
          key={index}
          className="border-blue-3 bg-card absolute inset-0 rounded-lg border"
          style={{ transform: `translate(${(index + 1) * 5}px, ${-(index + 1) * 5}px)` }}
        />
      ))}
      <div
        className={cn(
          "relative grid min-h-16 w-36 content-center rounded-lg border px-2 py-1",
          step.status === "done" && "bg-blue-1 border-blue-2",
          failed && cn("border-primary text-primary border-2", STRIPES),
          !failed && step.status !== "done" && "bg-muted text-muted-foreground border-transparent",
          (step.status === "running" || step.status === "waiting") && "bg-blue-1 border-primary border-2",
        )}
      >
        <div className={cn("grid min-w-0", failed && "bg-card text-foreground rounded-md px-2 py-1")}>
          <span className="truncate text-sm font-semibold">{name}</span>
          <span className="text-muted-foreground truncate text-xs">{sub ?? stateText(step)}</span>
          {sub ? <span className="truncate text-[11px] font-medium">{stateText(step)}</span> : null}
        </div>
      </div>
    </div>
  );
};

const StepMap = ({ map }: { map: FailureMapStep[] }) => (
  <Card className="gap-3 py-3">
    <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">Where it broke</h2>
    <div className="flex flex-wrap gap-x-4 gap-y-3 px-4 pt-2 pb-2">
      {map.map((step) => (
        <MapNode key={step.key} step={step} />
      ))}
    </div>
  </Card>
);

const FactCard = ({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) => (
  <div className={cn("min-w-0 rounded-lg border px-4 py-3", highlight ? "bg-blue-1 border-blue-2" : "bg-muted border-transparent")}>
    <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{label}</div>
    <div className="mt-1 text-sm break-words">{value}</div>
  </div>
);

const Move = ({ move }: { move: FailureMove }) => (
  <div className={cn("w-40 shrink-0 rounded-lg border px-3 py-2", move.bad ? "border-primary bg-blue-1" : "bg-card")}>
    <div className="truncate text-sm font-semibold">{move.label}</div>
    <div className="text-muted-foreground truncate font-mono text-xs" title={move.detail}>
      {move.detail}
    </div>
  </div>
);

const CopyCommand = ({ step, command, label }: { step: string; command: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
      >
        {copied ? "Command copied" : (label ?? `Resume from ${nameOf(step).name}`)}
      </Button>
      <code className="bg-muted min-w-0 truncate rounded-md px-2 py-1 font-mono text-xs" title={command}>
        {command}
      </code>
    </div>
  );
};

const GroupCard = ({
  ticket,
  group,
  resume,
}: {
  ticket: string;
  group: FailureGroup;
  resume: FailuresView["resume"];
}) => {
  const facts = [
    group.expected ? { label: "Expected", value: group.expected, highlight: false } : null,
    group.got ? { label: "Got", value: group.got, highlight: true } : null,
    group.said ? { label: "Worker said", value: group.said, highlight: false } : null,
    group.fixedIn ? { label: "Fixed in", value: group.fixedIn, highlight: false } : null,
  ].filter((fact) => fact !== null);
  const [composing, setComposing] = useState(false);
  const [noted, setNoted] = useState(false);
  const retryStep = group.steps[0] ?? resume?.step ?? "";
  const target = group.worker ?? nameOf(retryStep).name;
  return (
    <Card className="gap-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4">
        <h3 className="text-base font-semibold">Root cause · {group.kind.label}</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-blue-1 text-primary rounded-md px-2 py-1">
            {group.steps.length} {group.steps.length === 1 ? "step" : "steps"}
          </span>
          <span className="bg-muted rounded-md px-2 py-1 font-mono">{group.stepKind}</span>
        </div>
      </div>
      {facts.length > 0 ? (
        <div className="grid gap-3 px-4 md:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
          {facts.map((fact) => (
            <FactCard key={fact.label} {...fact} />
          ))}
        </div>
      ) : null}
      {group.worker ? (
        <div className="grid gap-2 px-4">
          <h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Last moves before it failed · {group.worker}
          </h4>
          <div className="flex flex-wrap items-center gap-2">
            {group.lastMoves.map((move, index) => (
              <Move key={index} move={move} />
            ))}
            <div className="border-primary bg-blue-1 text-primary w-40 shrink-0 rounded-lg border-2 border-dashed px-3 py-2">
              <div className="truncate text-sm font-semibold">Failed</div>
              <div className="truncate text-xs" title={group.title}>
                {group.title}
              </div>
            </div>
          </div>
          {group.lastMoves.length === 0 ? (
            <p className="text-muted-foreground text-xs">No events were recorded for this worker.</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 px-4">
        {group.worker ? (
          <Button asChild size="sm" variant="outline">
            <a
              href={`/api/tickets/${encodeURIComponent(ticket)}/log?agent=${encodeURIComponent(group.worker)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open raw log
            </a>
          </Button>
        ) : null}
        {resume && !noted ? <CopyCommand step={retryStep} command={resume.command} /> : null}
        {resume && !composing && !noted ? (
          <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
            Give a note and retry
          </Button>
        ) : null}
      </div>
      {resume && composing && !noted ? (
        <div className="grid gap-1 px-4">
          <span className="text-muted-foreground text-xs">Note for {target}, read on the next try.</span>
          <NoteComposer
            placeholder={`What should ${target} do differently?`}
            onCancel={() => setComposing(false)}
            onSend={async (text) => {
              const ok = await postNote(ticket, { text, targetAgent: target });
              if (ok) setNoted(true);
              return ok;
            }}
          />
        </div>
      ) : null}
      {resume && noted ? (
        <div className="grid gap-2 px-4">
          <span className="text-sm">Note saved for {target}. Run this command to retry with it.</span>
          <CopyCommand step={retryStep} command={resume.command} label={`Retry from ${nameOf(retryStep).name}`} />
        </div>
      ) : null}
    </Card>
  );
};

const KindBars = ({ kinds }: { kinds: FailuresView["kinds"] }) => {
  const max = Math.max(1, ...kinds.map((kind) => kind.count));
  return (
    <Card className="content-start gap-4 py-4">
      <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">
        Failure kinds · all tickets, 30 days
      </h2>
      {kinds.length === 0 ? <p className="text-muted-foreground px-4 text-sm">No failures in the last 30 days.</p> : null}
      <div className="grid gap-3 px-4">
        {kinds.map((kind, index) => (
          <div key={kind.id} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-3 text-sm">
            <span className="truncate" title={kind.label}>
              {kind.label}
            </span>
            <div className="bg-muted flex h-6 items-center rounded-md">
              <div
                className={cn("flex h-full items-center justify-end rounded-md px-2 text-xs font-semibold", index === 0 ? "bg-primary text-primary-foreground" : "bg-blue-3 text-foreground")}
                style={{ width: `${Math.max(12, (kind.count / max) * 100)}%` }}
              >
                {kind.count}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export const FailuresTab = ({ ticket }: { ticket: string }) => {
  const view = useFailures(ticket);
  if (!view) {
    return (
      <Card className="text-muted-foreground flex-1 items-center justify-center text-sm">
        {view === undefined ? "Loading failures" : "Failures are not available."}
      </Card>
    );
  }
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <div className="flex justify-end gap-6">
        <CountStat value={view.failedSteps} label="failed steps" />
        <CountStat value={view.groups.length} label="root causes" />
        <CountStat value={formatCost(view.costUsd)} label="spent on failures" />
      </div>
      <StepMap map={view.map} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,26%)] gap-3">
        <div className="grid min-h-0 content-start gap-3 overflow-y-auto">
          {view.groups.length === 0 ? (
            <Card className="text-muted-foreground items-center justify-center py-10 text-sm">
              This ticket has no failed steps.
            </Card>
          ) : null}
          {view.groups.map((group) => (
            <GroupCard key={group.key} ticket={ticket} group={group} resume={view.resume} />
          ))}
        </div>
        <KindBars kinds={view.kinds} />
      </div>
    </div>
  );
};
