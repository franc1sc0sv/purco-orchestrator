import { lazy, Suspense } from "react";
import { AlertList } from "@/components/alert-list";
import { Counter } from "@/components/counter";
import { FailedSteps, failedStepsOf } from "@/components/failed-steps";
import { DecisionTimeline } from "@/components/decision-timeline";
import { GateDialog } from "@/components/gate-dialog";
import { GatePanel } from "@/components/gate-panel";
import { Panel } from "@/components/panel";
import { PipelineStrip } from "@/components/stage-bars";
import { SizeChip, StateBadge } from "@/components/state-badge";
import { PanelSkeleton, TicketSkeleton } from "@/components/screen-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useGateDialog } from "@/hooks/use-gate-dialog";
import { useNow } from "@/hooks/use-now";
import { formatCost, formatDuration, formatTokens } from "@/lib/format";
import type { TicketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const AgentDiagram = lazy(() =>
  import("@/components/agent-diagram").then((module) => ({ default: module.AgentDiagram })),
);
const BurnChart = lazy(() =>
  import("@/components/burn-chart").then((module) => ({ default: module.BurnChart })),
);
const CostChart = lazy(() =>
  import("@/components/cost-chart").then((module) => ({ default: module.CostChart })),
);

const Stat = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className="grid">
    <span className="font-mono text-base leading-tight font-semibold">{children}</span>
    <span className="text-muted-foreground text-xs leading-tight">{label}</span>
  </div>
);

const DecisionSheet = ({ detail }: { detail: TicketDetail }) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button size="sm" variant="outline">
        Decisions ({detail.decisions.length})
      </Button>
    </SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Decision log</SheetTitle>
        <SheetDescription>Every lead decision of {detail.summary.ticket}.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 px-4">
        <DecisionTimeline decisions={detail.decisions} />
      </div>
      <div className="p-4">
        <SheetClose asChild>
          <Button variant="secondary" className="w-full">
            Close
          </Button>
        </SheetClose>
      </div>
    </SheetContent>
  </Sheet>
);

export const TicketView = ({ detail, review }: { detail: TicketDetail | undefined; review: number }) => {
  const now = useNow(1000);
  const item = detail?.items[0];
  const dialog = useGateDialog(item?.id, review);
  if (!detail) return <TicketSkeleton />;
  const { summary } = detail;
  const failedSteps = summary.state === "failed" && !item ? failedStepsOf(detail.pipeline) : [];
  const compact = item !== undefined || failedSteps.length > 0;
  const running = summary.endedAt === null;
  const elapsed = running && summary.startedAt ? now - Date.parse(summary.startedAt) : summary.elapsedMs;
  return (
    <div className="grid size-full grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
      <Card className="gap-0 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href="#/">tickets</a>
            </Button>
            <span className="font-mono text-xl font-semibold">{summary.ticket}</span>
            <SizeChip size={summary.size} />
            <StateBadge state={summary.state} />
          </div>
          <div className="flex items-center gap-5">
            <Stat label="cost">
              <Counter value={summary.costUsd} format={formatCost} />
            </Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="tokens">
              <Counter value={summary.tokens} format={formatTokens} />
            </Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="elapsed">{formatDuration(Math.max(0, elapsed))}</Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="agents">{summary.liveAgents}</Stat>
            <DecisionSheet detail={detail} />
          </div>
        </div>
      </Card>

      <Card className="px-4 py-2">
        <PipelineStrip pipeline={detail.pipeline} cost={detail.cost} nowMs={now} />
      </Card>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(380px,34%)] gap-3">
        <Panel title="Agents">
          <Suspense fallback={<PanelSkeleton />}>
            <AgentDiagram
              workers={detail.workers}
              liveWorkerIds={detail.liveWorkerIds}
              pipeline={detail.pipeline}
              alive={summary.activeRun !== null}
              stuck={summary.state === "stuck"}
            />
          </Suspense>
        </Panel>
        <div
          className={cn(
            "grid min-h-0 gap-3",
            compact ? "grid-rows-[9rem_minmax(0,2fr)_minmax(0,3fr)]" : "grid-rows-[minmax(0,5fr)_minmax(0,4fr)]",
          )}
        >
          {item ? (
            <Panel title={detail.items.length > 1 ? `Waiting for you (${detail.items.length})` : "Waiting for you"}>
              <GatePanel item={item} count={detail.items.length} onReview={() => dialog.setOpen(true)} />
            </Panel>
          ) : null}
          {failedSteps.length > 0 ? (
            <Panel title={`Failed steps (${failedSteps.length})`}>
              <FailedSteps steps={failedSteps} />
            </Panel>
          ) : null}
          <Panel title="Alerts">
            <AlertList alerts={detail.alerts} onReview={item ? () => dialog.setOpen(true) : undefined} />
          </Panel>
          <div className="grid min-h-0 grid-rows-2 gap-3">
          <Panel title="Burn rate">
            <Suspense fallback={<PanelSkeleton />}>
              <BurnChart samples={detail.samples} workers={detail.workers} />
            </Suspense>
          </Panel>
          <Panel title="Cost by step">
            <Suspense fallback={<PanelSkeleton />}>
              <CostChart cost={detail.cost} pipeline={detail.pipeline} />
            </Suspense>
          </Panel>
          </div>
        </div>
      </div>
      {item ? (
        <GateDialog
          key={item.id}
          ticket={summary.ticket}
          item={item}
          open={dialog.open}
          onOpenChange={dialog.setOpen}
        />
      ) : null}
    </div>
  );
};
