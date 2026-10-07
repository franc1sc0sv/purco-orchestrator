import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PipelineStage, PipelineStep } from "@/lib/types";

const TOOLTIP_DELAY_MS = 300;

export const failedStepsOf = (pipeline: PipelineStage[]): PipelineStep[] =>
  pipeline.flatMap((stage) => stage.steps).filter((step) => step.status === "failed");

export const FailedSteps = ({ steps }: { steps: PipelineStep[] }) => (
  <div className="grid size-full content-start gap-1 overflow-y-auto">
    {steps.map((step) => (
      <Tooltip key={step.key} delayDuration={TOOLTIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <div className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-sm">
            <span className="shrink-0 font-mono text-xs">{step.key}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{step.reason ?? "no reason recorded"}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-h-64 max-w-sm overflow-y-auto text-left break-words whitespace-pre-wrap">
          {step.reason ?? "no reason recorded"}
        </TooltipContent>
      </Tooltip>
    ))}
  </div>
);
