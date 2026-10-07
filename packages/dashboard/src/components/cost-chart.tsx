import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartRow } from "@/components/chart-row";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCost } from "@/lib/format";
import { STAGES, STAGE_LABELS, type CostRollup, type PipelineStage, type Stage } from "@/lib/types";

const STAGE_COLORS: Record<Stage, string> = {
  plan: "var(--chart-1)",
  implementation: "var(--chart-2)",
  testing: "var(--chart-3)",
  verification: "var(--chart-4)",
};

const config: ChartConfig = Object.fromEntries(
  STAGES.map((stage) => [stage, { label: STAGE_LABELS[stage], color: STAGE_COLORS[stage] }]),
);

type Row = { step: string } & Partial<Record<Stage, number>>;

export const CostChart = ({
  cost,
  pipeline,
}: {
  cost: CostRollup;
  pipeline: PipelineStage[];
}) => {
  const rows: Row[] = pipeline.flatMap((stage) =>
    stage.steps
      .filter((step) => (cost.steps[step.key]?.costUsd ?? 0) > 0)
      .map((step) => ({ step: step.key, [stage.stage]: cost.steps[step.key]?.costUsd ?? 0 })),
  );
  if (rows.length === 0) {
    return <div className="text-muted-foreground flex size-full items-center justify-center text-sm">no cost yet</div>;
  }
  return (
    <ChartContainer config={config} className="aspect-auto size-full">
      <BarChart data={rows} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="step" hide />
        <YAxis tickFormatter={formatCost} tickLine={false} axisLine={false} width={44} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => String(payload[0]?.payload?.step ?? "")}
              formatter={(value, name) => (
                <ChartRow name={String(name)} config={config}>
                  {formatCost(Number(value))}
                </ChartRow>
              )}
            />
          }
        />
        {STAGES.map((stage) => (
          <Bar
            key={stage}
            dataKey={stage}
            stackId="cost"
            fill={`var(--color-${stage})`}
            radius={3}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
};
