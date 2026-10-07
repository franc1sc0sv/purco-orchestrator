import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STEP_TONE, TONES } from "@/lib/colors";
import { formatCost, formatDuration } from "@/lib/format";
import {
  STAGE_LABELS,
  STAGE_SHORT_LABELS,
  type CostRollup,
  type PipelineStage,
  type StageSummary,
  type StepStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const stepFill = (status: StepStatus): number => (status === "pending" ? 0 : 100);

export const RowStageBars = ({ stages }: { stages: StageSummary[] }) => (
  <div className="relative grid grid-cols-4 gap-3">
    {stages.map((stage) => (
      <div key={stage.stage} className="grid gap-1">
        <span className="text-muted-foreground text-[10px] leading-none">
          {STAGE_SHORT_LABELS[stage.stage]}
        </span>
        <Progress
          value={Math.round(stage.progress * 100)}
          className={cn(
            TONES[STEP_TONE[stage.status]].vars,
            TONES[STEP_TONE[stage.status]].bar,
            stage.status === "running" && "animate-soft-pulse",
          )}
        />
      </div>
    ))}
  </div>
);

export const PipelineStrip = ({
  pipeline,
  cost,
  nowMs,
}: {
  pipeline: PipelineStage[];
  cost: CostRollup;
  nowMs: number;
}) => (
  <div className="grid grid-cols-4 gap-3">
    {pipeline.map((stage) => {
      const done = stage.steps.filter(
        (step) => step.status === "done" || step.status === "skipped",
      ).length;
      return (
        <div key={stage.stage} className="grid gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{STAGE_LABELS[stage.stage]}</span>
            <span className="text-muted-foreground font-mono text-xs">
              {done}/{stage.steps.length}
            </span>
          </div>
          <div className="bg-muted/60 flex h-5 gap-0.5 rounded-md p-0.5">
            {stage.steps.length === 0 ? (
              <Progress value={0} className="h-full rounded-sm" />
            ) : (
              stage.steps.map((step) => {
                const end = step.endedAt ? Date.parse(step.endedAt) : nowMs;
                const duration = step.startedAt ? end - Date.parse(step.startedAt) : 0;
                return (
                  <Tooltip key={step.key}>
                    <TooltipTrigger asChild>
                      <Progress
                        value={stepFill(step.status)}
                        className={cn(
                          "h-full min-w-2 flex-1 rounded-sm",
                          TONES[STEP_TONE[step.status]].vars,
                          TONES[STEP_TONE[step.status]].bar,
                          step.status === "running" && "animate-soft-pulse",
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="grid gap-0.5">
                        <span className="font-mono font-medium">{step.key}</span>
                        <span>{step.status}</span>
                        <span>{formatCost(cost.steps[step.key]?.costUsd ?? 0)}</span>
                        <span>{formatDuration(Math.max(0, duration))}</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })
            )}
          </div>
        </div>
      );
    })}
  </div>
);
