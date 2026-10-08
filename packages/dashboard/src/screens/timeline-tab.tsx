import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToolTicks, type ToolTick } from "@/hooks/use-tool-ticks";
import { ticketHref } from "@/hooks/use-route";
import { WORKER_LABEL } from "@/lib/colors";
import { clock, formatCost, formatDuration, formatTokens, shortModel } from "@/lib/format";
import type { Decision, PipelineStage, TicketDetail, Worker } from "@/lib/types";
import { STAGE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

const LANE_HEIGHT = 64;
const BAR_MIN = 6;
const BAR_MAX = 28;
const AXIS_STEPS_MS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((seconds) => seconds * 1000);
const TARGET_LABELS = 8;

type Range = { start: number; end: number };

const tokensOf = (worker: Worker): number => worker.tokensIn + worker.tokensOut;

const endOf = (worker: Worker, now: number): number => (worker.endedAt ? Date.parse(worker.endedAt) : now);

const rangeOf = (detail: TicketDetail, now: number): Range => {
  const starts = detail.workers.map((worker) => Date.parse(worker.startedAt));
  const summaryStart = detail.summary.startedAt ? Date.parse(detail.summary.startedAt) : Number.POSITIVE_INFINITY;
  const start = Math.min(summaryStart, ...starts);
  const finish = detail.summary.endedAt ? Date.parse(detail.summary.endedAt) : now;
  const end = Math.max(finish, ...detail.workers.map((worker) => endOf(worker, now)));
  return Number.isFinite(start) ? { start, end: Math.max(end, start + 1000) } : { start: now - 1000, end: now };
};

const percent = (time: number, range: Range): number =>
  Math.min(100, Math.max(0, ((time - range.start) / (range.end - range.start)) * 100));

const axisLabel = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  if (ms === 0) return "0m";
  return ms % 60000 === 0 ? `${minutes}m` : `${minutes}m${Math.round((ms % 60000) / 1000)}s`;
};

const axisMarks = (range: Range): number[] => {
  const span = range.end - range.start;
  const step = AXIS_STEPS_MS.find((candidate) => span / candidate <= TARGET_LABELS) ?? AXIS_STEPS_MS.at(-1) ?? span;
  return Array.from({ length: Math.floor(span / step) + 1 }, (_, index) => index * step);
};

const bandOf = (stage: PipelineStage, now: number): Range | null => {
  const starts = stage.steps.flatMap((step) => (step.startedAt ? [Date.parse(step.startedAt)] : []));
  if (starts.length === 0) return null;
  const ends = stage.steps.map((step) => (step.endedAt ? Date.parse(step.endedAt) : now));
  return { start: Math.min(...starts), end: Math.max(...ends) };
};

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-4">
    <span className="opacity-70">{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);

const WorkerTip = ({ worker, now }: { worker: Worker; now: number }) => (
  <div className="grid min-w-44 gap-0.5">
    <span className="font-semibold">{worker.label}</span>
    <Fact label="tokens" value={formatTokens(tokensOf(worker))} />
    <Fact label="cost" value={formatCost(worker.costUsd)} />
    <Fact label="turns" value={String(worker.turns)} />
    <Fact label="duration" value={formatDuration(endOf(worker, now) - Date.parse(worker.startedAt))} />
    <Fact label="state" value={WORKER_LABEL[worker.state]} />
  </div>
);

const Lane = ({
  worker,
  range,
  now,
  maxTokens,
  ticks,
  selected,
}: {
  worker: Worker;
  range: Range;
  now: number;
  maxTokens: number;
  ticks: ToolTick[];
  selected: boolean;
}) => {
  const start = Date.parse(worker.startedAt);
  const end = endOf(worker, now);
  const left = percent(start, range);
  const width = Math.max(0.4, percent(end, range) - left);
  const height = BAR_MIN + (tokensOf(worker) / maxTokens) * (BAR_MAX - BAR_MIN);
  const own = ticks.filter((tick) => {
    const at = Date.parse(tick.at);
    return (tick.agent === worker.label || tick.agent === worker.id) && at >= start && at <= end;
  });
  return (
    <>
      <div className="grid content-center px-1">
        <a
          href={`#/t/${encodeURIComponent(worker.ticket)}/live?agent=${encodeURIComponent(worker.id)}`}
          className="truncate text-sm font-semibold hover:underline"
        >
          {worker.label}
        </a>
        <span className="text-muted-foreground truncate text-xs">
          {shortModel(worker.model)} · {formatTokens(tokensOf(worker))} tokens
        </span>
      </div>
      <div className="relative" style={{ height: LANE_HEIGHT }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn("absolute rounded-md", selected ? "bg-primary" : "bg-blue-3")}
              style={{ left: `${left}%`, width: `${width}%`, height, top: 8 + (BAR_MAX - height) / 2 }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <WorkerTip worker={worker} now={now} />
          </TooltipContent>
        </Tooltip>
        {own.map((tick, index) => (
          <div
            key={index}
            className="bg-blue-2 absolute h-2 w-px"
            style={{ left: `${percent(Date.parse(tick.at), range)}%`, top: 8 + BAR_MAX + 6 }}
          />
        ))}
      </div>
    </>
  );
};

const LeadLane = ({ decisions, range }: { decisions: Decision[]; range: Range }) => (
  <>
    <div className="grid content-center px-1">
      <span className="text-sm font-semibold">Lead</span>
      <span className="text-muted-foreground text-xs">{decisions.length} decisions</span>
    </div>
    <div className="relative" style={{ height: LANE_HEIGHT }}>
      <div className="bg-blue-1 absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2" />
      {decisions.map((decision) => (
        <Tooltip key={decision.id}>
          <TooltipTrigger asChild>
            <div
              className="bg-blue-4 absolute top-1/2 h-6 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm"
              style={{ left: `${percent(Date.parse(decision.at), range)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent className="max-w-80">
            <div className="grid gap-1">
              <span className="font-mono opacity-70">
                {decision.step} · {clock(decision.at)}
              </span>
              <span className="line-clamp-6 whitespace-pre-line">{decision.decision || decision.text}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  </>
);

const StageBands = ({ pipeline, range, now }: { pipeline: PipelineStage[]; range: Range; now: number }) => (
  <div className="relative h-8">
    {pipeline.map((stage) => {
      const band = bandOf(stage, now);
      if (!band) return null;
      const left = percent(band.start, range);
      const width = Math.max(0.5, percent(band.end, range) - left);
      return (
        <div key={stage.stage} className="absolute top-0 grid gap-1" style={{ left: `${left}%`, width: `${width}%` }}>
          <div className={cn("h-1.5 rounded-full", stage.status === "running" ? "bg-primary" : "bg-blue-2")} />
          <span className="text-muted-foreground truncate text-[11px] font-semibold tracking-wider uppercase">
            {STAGE_LABELS[stage.stage]}
          </span>
        </div>
      );
    })}
  </div>
);

const clockOf = (detail: TicketDetail, wallNow: number): number => {
  if (detail.liveWorkerIds.length > 0) return wallNow;
  const seen = detail.workers.map((worker) => Date.parse(worker.endedAt ?? worker.lastEventAt));
  const last = Math.max(...seen.filter(Number.isFinite));
  return Number.isFinite(last) ? last : wallNow;
};

export const TimelineTab = ({
  detail,
  now: wallNow,
  playhead,
}: {
  detail: TicketDetail;
  now: number;
  playhead: number | null;
}) => {
  const ticks = useToolTicks(detail.summary.ticket);
  const now = clockOf(detail, wallNow);
  const surface = useRef<HTMLDivElement>(null);
  const [dragAt, setDragAt] = useState<number | null>(null);
  const range = rangeOf(detail, now);
  const workers = [...detail.workers].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const maxTokens = Math.max(1, ...workers.map(tokensOf));
  const shown = dragAt ?? playhead;
  const timeAt = (clientX: number): number => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return range.start;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(range.start + fraction * (range.end - range.start));
  };
  const commit = (at: number) => {
    window.location.hash = ticketHref(detail.summary.ticket, "timeline", { t: new Date(at).toISOString() });
  };
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragAt(timeAt(event.clientX));
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragAt !== null) setDragAt(timeAt(event.clientX));
  };
  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (dragAt === null) return;
    commit(timeAt(event.clientX));
    setDragAt(null);
  };
  const handle = { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag };
  return (
    <Card className="min-h-0 flex-1 gap-0 overflow-y-auto px-4 py-4">
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 right-6 left-48" ref={surface}>
          {axisMarks(range).map((offset) => (
            <div
              key={offset}
              className="bg-border absolute inset-y-6 w-px"
              style={{ left: `${percent(range.start + offset, range)}%` }}
            />
          ))}
          {shown !== null ? (
            <div className="absolute inset-y-0 -ml-px w-0.5" style={{ left: `${percent(shown, range)}%` }}>
              <div className="bg-primary absolute inset-y-0 w-0.5" />
              <div
                {...handle}
                className="bg-primary text-primary-foreground pointer-events-auto absolute -bottom-2 left-0 -translate-x-1/2 cursor-col-resize touch-none rounded-md px-2 py-0.5 font-mono text-xs whitespace-nowrap select-none"
              >
                {clock(new Date(shown).toISOString())}
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] pr-6 pb-8">
          <div />
          <div {...handle} className="relative cursor-col-resize touch-none select-none">
            <div className="relative h-6">
              {axisMarks(range).map((offset) => (
                <span
                  key={offset}
                  className="text-muted-foreground absolute text-xs"
                  style={{ left: `${percent(range.start + offset, range)}%` }}
                >
                  {axisLabel(offset)}
                </span>
              ))}
            </div>
            <StageBands pipeline={detail.pipeline} range={range} now={now} />
          </div>
          <LeadLane decisions={detail.decisions} range={range} />
          {workers.map((worker) => (
            <Lane
              key={worker.id}
              worker={worker}
              range={range}
              now={now}
              maxTokens={maxTokens}
              ticks={ticks}
              selected={detail.liveWorkerIds.includes(worker.id)}
            />
          ))}
        </div>
      </div>
      <p className="text-muted-foreground mt-4 text-xs">
        Bar height = tokens. Ticks = tool calls. Lead marks = each decision it logged. Drag or click the axis to replay a moment.
      </p>
    </Card>
  );
};
