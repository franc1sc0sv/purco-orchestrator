import { useEffect, useState } from "react";
import { RowsSkeleton } from "@/components/screen-skeleton";
import { SizeChip } from "@/components/state-badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCost, formatDuration, formatTokens } from "@/lib/format";
import { STAGES, STAGE_LABELS, type HistoryEntry, type Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGE_BARS: Record<Stage, string> = {
  plan: "bg-chart-1/20 [&>[data-slot=progress-indicator]]:bg-chart-1",
  implementation: "bg-chart-2/20 [&>[data-slot=progress-indicator]]:bg-chart-2",
  testing: "bg-chart-3/20 [&>[data-slot=progress-indicator]]:bg-chart-3",
  verification: "bg-chart-4/20 [&>[data-slot=progress-indicator]]:bg-chart-4",
};

const DurationBar = ({ entry }: { entry: HistoryEntry }) => {
  const total = STAGES.reduce((sum, stage) => sum + entry.stageDurationsMs[stage], 0);
  return (
    <div className="flex h-3 w-72 gap-0.5">
      {STAGES.map((stage) => {
        const ms = entry.stageDurationsMs[stage];
        if (ms <= 0 || total <= 0) return null;
        return (
          <Tooltip key={stage}>
            <TooltipTrigger asChild>
              <Progress
                value={100}
                className={cn("h-full rounded-sm", STAGE_BARS[stage])}
                style={{ width: `${(ms / total) * 100}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {STAGE_LABELS[stage]} {formatDuration(ms)}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};

export const HistoryScreen = () => {
  const [entries, setEntries] = useState<HistoryEntry[] | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/history", { signal: controller.signal })
      .then((response) => response.json())
      .then((value: HistoryEntry[]) => setEntries(value))
      .catch(() => setEntries([]));
    return () => controller.abort();
  }, []);

  if (!entries) return <RowsSkeleton />;
  if (entries.length === 0) return <div className="text-muted-foreground p-10 text-center">no finished tickets</div>;
  return (
    <Card className="py-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ticket</TableHead>
            <TableHead>size</TableHead>
            <TableHead>cost</TableHead>
            <TableHead>tokens</TableHead>
            <TableHead>duration</TableHead>
            <TableHead>stages</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.ticket}>
              <TableCell>
                <a href={`#/ticket/${encodeURIComponent(entry.ticket)}`} className="font-mono font-semibold">
                  {entry.ticket}
                </a>
              </TableCell>
              <TableCell>
                <SizeChip size={entry.size} />
              </TableCell>
              <TableCell className="font-mono">{formatCost(entry.costUsd)}</TableCell>
              <TableCell className="font-mono">{formatTokens(entry.tokens)}</TableCell>
              <TableCell className="font-mono">{formatDuration(entry.durationMs)}</TableCell>
              <TableCell>
                <DurationBar entry={entry} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};
