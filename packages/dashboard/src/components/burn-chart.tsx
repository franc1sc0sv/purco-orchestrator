import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartRow } from "@/components/chart-row";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { clock, formatTokens } from "@/lib/format";
import type { Sample, Worker } from "@/lib/types";

const MAX_SERIES = 5;
const BUCKET_MS = 20_000;
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const SERIES_DASH = [undefined, "6 3", "2 3", "8 3 2 3", "1 4"];
const SERIES_OPACITY = [0.5, 0.4, 0.3, 0.25, 0.2];

type Row ={ at: number } & Record<string, number>;

const buildSeries = (
  samples: Sample[],
  workers: Worker[],
): { rows: Row[]; config: ChartConfig; keys: string[] } => {
  const byWorker = new Map<string, Sample[]>();
  for (const sample of samples) {
    const list = byWorker.get(sample.workerId) ?? [];
    list.push(sample);
    byWorker.set(sample.workerId, list);
  }
  const ranked = [...byWorker.entries()]
    .sort(
      (a, b) =>
        (b[1][b[1].length - 1]?.tokens ?? 0) - (a[1][a[1].length - 1]?.tokens ?? 0),
    )
    .slice(0, MAX_SERIES);
  const config: ChartConfig = {};
  const keys: string[] = [];
  const buckets = new Map<number, Row>();
  ranked.forEach(([workerId, list], index) => {
    const key = `w${index}`;
    keys.push(key);
    const worker = workers.find((candidate) => candidate.id === workerId);
    config[key] = {
      label: worker ? `${worker.role} ${worker.label}` : workerId,
      color: SERIES_COLORS[index % SERIES_COLORS.length] ?? "var(--chart-1)",
    };
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1];
      const current = list[i];
      if (!previous || !current) continue;
      const minutes = (Date.parse(current.at) - Date.parse(previous.at)) / 60_000;
      if (minutes <= 0) continue;
      const rate = Math.max(0, (current.tokens - previous.tokens) / minutes);
      const at = Math.floor(Date.parse(current.at) / BUCKET_MS) * BUCKET_MS;
      const row = buckets.get(at) ?? ({ at } as Row);
      row[key] = Math.round(rate);
      buckets.set(at, row);
    }
  });
  const rows = [...buckets.values()].sort((a, b) => a.at - b.at);
  for (const row of rows) for (const key of keys) row[key] ??= 0;
  return { rows, config, keys };
};

export const BurnChart = ({ samples, workers }: { samples: Sample[]; workers: Worker[] }) => {
  const { rows, config, keys } = buildSeries(samples, workers);
  if (rows.length < 2) {
    return <div className="text-muted-foreground flex size-full items-center justify-center text-sm">no samples yet</div>;
  }
  return (
    <ChartContainer config={config} className="aspect-auto size-full">
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(value: number) => clock(new Date(value).toISOString())}
          tickLine={false}
          axisLine={false}
          minTickGap={48}
        />
        <YAxis tickFormatter={formatTokens} tickLine={false} axisLine={false} width={48} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => clock(new Date(Number(payload[0]?.payload?.at)).toISOString())}
              formatter={(value, name) => (
                <ChartRow name={String(name)} config={config}>
                  {formatTokens(Number(value))}/min
                </ChartRow>
              )}
            />
          }
        />
        {keys.map((key, index) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stackId="burn"
            stroke={`var(--color-${key})`}
            strokeDasharray={SERIES_DASH[index % SERIES_DASH.length]}
            fill={`var(--color-${key})`}
            fillOpacity={SERIES_OPACITY[index % SERIES_OPACITY.length]}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
};
