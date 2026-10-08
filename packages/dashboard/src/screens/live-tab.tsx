import { lazy, Suspense } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { AlertList } from "@/components/alert-list";
import { AnswerNeeded } from "@/components/answer-needed";
import { FailedSteps, failedStepsOf } from "@/components/failed-steps";
import { ForgeActivity, isTesting } from "@/components/forge-activity";
import { GatePanel } from "@/components/gate-panel";
import { Panel } from "@/components/panel";
import { PanelSkeleton } from "@/components/screen-skeleton";
import { PipelineStrip } from "@/components/stage-bars";
import { Card } from "@/components/ui/card";
import { eventsOfWorker } from "@/lib/agent-activity";
import { clock } from "@/lib/format";
import { replayTimeOf } from "@/lib/replay";
import type { OpenItem, TicketDetail } from "@/lib/types";
import { ticketHref } from "@/hooks/use-route";
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

export const LiveTab = ({
  detail,
  items,
  now,
  agentId,
  replay,
  onReview,
}: {
  detail: TicketDetail;
  items: OpenItem[];
  now: number;
  agentId: string | null;
  replay: string | null;
  onReview: () => void;
}) => {
  const { summary } = detail;
  const item = items[0];
  const failedSteps = summary.state === "failed" && !item ? failedStepsOf(detail.pipeline) : [];
  const selected = detail.workers.find((worker) => worker.id === agentId);
  const ticketId = summary.ticket;
  const replayAt = replay === null ? null : replayTimeOf(new URLSearchParams({ t: replay }));
  const keep: Record<string, string> = replay === null ? {} : { t: replay };
  const clockNow = replayAt ?? now;
  const compact = item !== undefined || failedSteps.length > 0;
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      {summary.awaitingGrill ? (
        <AnswerNeeded ticket={summary.ticket} grill={summary.awaitingGrill} className="mx-0 mb-0 py-3" />
      ) : null}
      {replayAt !== null ? (
        <Card className="bg-blue-1 border-blue-2 flex-row items-center justify-between px-4 py-2">
          <span className="text-sm font-semibold">Showing the run at {clock(new Date(replayAt).toISOString())}</span>
          <a href={ticketHref(ticketId, "live")} className="text-primary text-sm font-semibold hover:underline">
            Back to live
          </a>
        </Card>
      ) : null}
      <Card className="px-4 py-2">
        <PipelineStrip pipeline={detail.pipeline} cost={detail.cost} nowMs={clockNow} />
      </Card>
      {isTesting(detail.pipeline) ? <ForgeActivity tests={detail.tests} now={clockNow} /> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,34%)] gap-3">
        <Panel title="Agents">
          <Suspense fallback={<PanelSkeleton />}>
            <AgentDiagram
              workers={detail.workers}
              liveWorkerIds={detail.liveWorkerIds}
              pipeline={detail.pipeline}
              alive={summary.activeRun !== null}
              stuck={summary.state === "stuck"}
              events={detail.events}
              selectedId={selected?.id}
              onSelect={(workerId) => {
                window.location.hash = ticketHref(ticketId, "live", { ...keep, agent: workerId });
              }}
            />
          </Suspense>
        </Panel>
        {selected ? (
          <AgentPanel
            worker={selected}
            events={eventsOfWorker(detail.events, selected)}
            tests={detail.tests}
            now={clockNow}
            closeHref={ticketHref(ticketId, "live", keep)}
          />
        ) : (
        <div
          className={cn(
            "grid min-h-0 gap-3",
            compact ? "grid-rows-[9rem_minmax(0,2fr)_minmax(0,3fr)]" : "grid-rows-[minmax(0,5fr)_minmax(0,4fr)]",
          )}
        >
          {item ? (
            <Panel title={items.length > 1 ? `Waiting for you (${items.length})` : "Waiting for you"}>
              <GatePanel item={item} count={items.length} onReview={onReview} />
            </Panel>
          ) : null}
          {failedSteps.length > 0 ? (
            <Panel title={`Failed steps (${failedSteps.length})`}>
              <FailedSteps steps={failedSteps} />
            </Panel>
          ) : null}
          <Panel title="Alerts">
            <AlertList alerts={detail.alerts} onReview={item ? onReview : undefined} />
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
        )}
      </div>
    </div>
  );
};
