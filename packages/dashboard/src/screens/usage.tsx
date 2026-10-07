import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { LimitsPanel } from "@/components/limits-panel";
import { FlowField } from "@/components/flow-field";
import { Panel } from "@/components/panel";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useNow } from "@/hooks/use-now";
import { clock, formatCost, formatCountdown, formatTokens } from "@/lib/format";
import type { UsageSnapshot } from "@/lib/types";

const MODEL_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const dayLabel = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: "short" });

const modelKey = (model: string): string => `m-${model.replace(/[^A-Za-z0-9]+/g, "-")}`;

const dayConfig = { tokens: { label: "Tokens", color: "var(--chart-1)" } } satisfies ChartConfig;
const blockConfig = { tokens: { label: "Tokens", color: "var(--chart-2)" } } satisfies ChartConfig;

const Figure = ({ label, value }: { label: string; value: string }) => (
  <div className="grid">
    <span className="font-mono text-xl font-semibold">{value}</span>
    <span className="text-muted-foreground text-xs">{label}</span>
  </div>
);

export const UsageScreen = ({ usage }: { usage: UsageSnapshot | undefined }) => {
  const now = useNow(15_000);
  if (!usage?.ready) return <Skeleton className="h-96 rounded-xl" />;
  const { block } = usage;
  const remaining = block ? Math.max(0, Date.parse(block.endsAt) - now) : 0;
  const modelConfig: ChartConfig = Object.fromEntries(
    usage.models.map((entry, index) => [
      modelKey(entry.model),
      { label: entry.model, color: MODEL_COLORS[index % MODEL_COLORS.length] ?? "var(--chart-1)" },
    ]),
  );
  const modelRows = usage.models.map((entry) => ({
    key: modelKey(entry.model),
    model: entry.model,
    costUsd: entry.costUsd,
    tokens: entry.tokens,
    fill: `var(--color-${modelKey(entry.model)})`,
  }));
  const days = usage.days.map((day) => ({ ...day, label: dayLabel(day.date) }));
  return (
    <div className="grid gap-3">
      <LimitsPanel limits={usage.limits} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="relative gap-3 overflow-hidden px-5 py-4">
          {block ? (
            <FlowField rate={block.burnTokensPerMin} elapsedFraction={block.elapsedFraction} />
          ) : null}
          <span className="relative text-sm font-semibold">Current 5 hour block</span>
          {block ? (
            <div className="relative grid grid-cols-3 gap-3">
              <Figure label="tokens" value={formatTokens(block.totals.tokens)} />
              <Figure label="cost" value={formatCost(block.totals.costUsd)} />
              <Figure label="resets in" value={formatCountdown(remaining)} />
              <Figure label="burn per minute" value={formatTokens(block.burnTokensPerMin)} />
              <Figure label="projected" value={formatTokens(block.projectedTokens)} />
              <Figure label="messages" value={String(block.totals.messages)} />
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">No active block.</span>
          )}
        </Card>
        <Card className="gap-3 px-5 py-4">
          <span className="text-sm font-semibold">Last 7 days</span>
          <div className="grid grid-cols-3 gap-3">
            <Figure label="tokens" value={formatTokens(usage.rolling.tokens)} />
            <Figure label="cost" value={formatCost(usage.rolling.costUsd)} />
            <Figure label="messages" value={String(usage.rolling.messages)} />
          </div>
        </Card>
        <Card className="gap-3 px-5 py-4">
          <span className="text-sm font-semibold">This week from Monday</span>
          <div className="grid grid-cols-3 gap-3">
            <Figure label="tokens" value={formatTokens(usage.calendar.tokens)} />
            <Figure label="cost" value={formatCost(usage.calendar.costUsd)} />
            <Figure label="messages" value={String(usage.calendar.messages)} />
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Tokens per day" className="h-72">
          <ChartContainer config={dayConfig} className="aspect-auto size-full">
            <BarChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={formatTokens} tickLine={false} axisLine={false} width={52} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => String(payload[0]?.payload?.date ?? "")}
                    formatter={(value, _name, item) => (
                      <span className="font-mono">
                        {formatTokens(Number(value))} / {formatCost(Number(item.payload?.costUsd ?? 0))}
                      </span>
                    )}
                  />
                }
              />
              <Bar dataKey="tokens" fill="var(--color-tokens)" radius={4} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </Panel>
        <Panel title="Block burn" className="h-72">
          {block && block.series.length > 1 ? (
            <ChartContainer config={blockConfig} className="aspect-auto size-full">
              <AreaChart
                data={block.series.map((point) => ({ at: Date.parse(point.at), tokens: point.tokens }))}
                margin={{ left: 0, right: 8, top: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="at"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(value: number) => clock(new Date(value).toISOString())}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={56}
                />
                <YAxis tickFormatter={formatTokens} tickLine={false} axisLine={false} width={52} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => clock(new Date(Number(payload[0]?.payload?.at)).toISOString())}
                      formatter={(value) => <span className="font-mono">{formatTokens(Number(value))}</span>}
                    />
                  }
                />
                <Area
                  dataKey="tokens"
                  type="monotone"
                  stroke="var(--color-tokens)"
                  fill="var(--color-tokens)"
                  fillOpacity={0.3}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="text-muted-foreground flex size-full items-center justify-center text-sm">
              no active block
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Cost by model, last 7 days" className="h-64">
        <ChartContainer config={modelConfig} className="aspect-auto size-full">
          <BarChart data={modelRows} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid horizontal={false} />
            <YAxis dataKey="model" type="category" tickLine={false} axisLine={false} width={150} />
            <XAxis type="number" tickFormatter={formatCost} tickLine={false} axisLine={false} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value, _name, item) => (
                    <span className="font-mono">
                      {item.payload?.model} {formatCost(Number(value))} / {formatTokens(Number(item.payload?.tokens ?? 0))}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="costUsd" radius={4} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Panel>
    </div>
  );
};
