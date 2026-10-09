import { lazy, Suspense, useState } from "react";
import { FlowView } from "@/components/flow-view";
import { AgentPanel } from "@/components/agent-panel";
import { AlertList } from "@/components/alert-list";
import { AnswerNeeded } from "@/components/answer-needed";
import { FailedSteps, failedStepsOf } from "@/components/failed-steps";
import { ForgeActivity, isTesting } from "@/components/forge-activity";
import { JobPanel, jobProgress } from "@/components/job-panel";
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
  const selectedJob = detail.tests.jobs.find((job) => `job:${job.id}` === agentId);
  const alive = summary.activeRun !== null;
  const [view, setView] = useState<"flow" | "diagram">("flow");
  const select = (id: string) => {
    window.location.hash = ticketHref(ticketId, "live", { ...keep, agent: id });
  };
  const selectedKey = selected?.id ?? (selectedJob ? `job:${selectedJob.id}` : undefined);
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
        <Panel
          title="Agents"
          action={
            <div className="flex gap-1">
              {(["flow", "diagram"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-semibold capitalize",
                    view === option ? "bg-blue-1 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          }
        >
          {view === "flow" ? (
            <FlowView
              workers={detail.workers}
              liveWorkerIds={detail.liveWorkerIds}
              jobs={detail.tests.jobs}
              pipeline={detail.pipeline}
              alive={alive}
              now={clockNow}
              selectedId={selectedKey}
              progressOf={(job) => jobProgress(job, detail.tests, alive)}
              onSelect={select}
            />
          ) : (
            <Suspense fallback={<PanelSkeleton />}>
              <AgentDiagram
                workers={detail.workers}
                liveWorkerIds={detail.liveWorkerIds}
                pipeline={detail.pipeline}
                alive={alive}
                stuck={summary.state === "stuck"}
                events={detail.events}
                jobs={detail.tests.jobs}
                progressOf={(job) => jobProgress(job, detail.tests, alive)}
                now={clockNow}
                selectedId={selectedKey}
                onSelect={select}
              />
            </Suspense>
          )}
        </Panel>
        {selectedJob ? (
          <JobPanel
            job={selectedJob}
            tests={detail.tests}
            alive={alive}
            now={clockNow}
            closeHref={ticketHref(ticketId, "live", keep)}
          />
        ) : selected ? (
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
