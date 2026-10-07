import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { TONES } from "@/lib/colors";
import { formatAgo, formatResetAt, formatResetAtShort, formatResetShort } from "@/lib/format";
import type { LimitWindow, UsageSnapshot } from "@/lib/types";

const Gauge = ({
  label,
  window,
  now,
  relative,
}: {
  label: string;
  window: LimitWindow;
  now: number;
  relative: boolean;
}) => {
  const pct = Math.round(window.pct);
  const reset = relative ? formatResetShort(window.resetsAt - now) : formatResetAtShort(window.resetsAt);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium">
            {label} {pct}% · {reset}
          </span>
          <Progress
            value={Math.min(100, pct)}
            className={`h-1 w-16 rounded-lg ${TONES.running.vars} ${TONES.running.bar}`}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label} {pct}% used. Resets {formatResetAt(window.resetsAt)}. Updated {formatAgo(now - window.at)} from the{" "}
        {window.source === "statusline" ? "status line" : "engine"}.
      </TooltipContent>
    </Tooltip>
  );
};

export const UsageStrip = ({ usage }: { usage: UsageSnapshot | undefined }) => {
  const now = useNow(15_000);
  const limits = usage?.limits;
  if (!limits) return <span className="text-muted-foreground text-xs">reading limits</span>;
  const { session, weekly } = limits;
  return (
    <a href="#/usage" className="flex items-center gap-4 rounded-lg px-2 py-1 outline-none hover:bg-accent/40">
      {session ? <Gauge label="Session" window={session} now={now} relative /> : null}
      {weekly ? <Gauge label="Week" window={weekly} now={now} relative={false} /> : null}
      {session || weekly ? null : <span className="text-muted-foreground text-xs">no limit data</span>}
    </a>
  );
};
