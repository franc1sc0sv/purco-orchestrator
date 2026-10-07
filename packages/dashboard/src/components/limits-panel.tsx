import { LimitRow } from "@/components/limit-row";
import { Card } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import { formatAgo } from "@/lib/format";
import type { PlanLimits } from "@/lib/types";

export const LimitsPanel = ({ limits }: { limits: PlanLimits }) => {
  const now = useNow(15_000);
  const windows = [limits.session, limits.weekly, ...limits.weeklyByModel];
  const stamps = windows.flatMap((window) => (window ? [window.at] : []));
  const latest = stamps.length > 0 ? Math.max(...stamps) : undefined;
  return (
    <Card className="gap-4 px-5 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Plan usage limits</span>
        {latest === undefined ? null : (
          <span className="text-muted-foreground text-xs">as of {formatAgo(now - latest)}</span>
        )}
      </div>
      {latest === undefined ? (
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-sm">No limit data yet. Install the status line:</span>
          <code className="bg-muted overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs whitespace-pre">
            {limits.installCommand}
          </code>
        </div>
      ) : (
        <div className="grid gap-5">
          {limits.session ? <LimitRow label="Session limit" window={limits.session} now={now} relative /> : null}
          {limits.weekly ? (
            <LimitRow label="Weekly · all models" window={limits.weekly} now={now} relative={false} />
          ) : null}
          {limits.weeklyByModel.map((entry) => (
            <LimitRow key={entry.model} label={`Weekly · ${entry.model}`} window={entry} now={now} relative={false} />
          ))}
        </div>
      )}
    </Card>
  );
};
