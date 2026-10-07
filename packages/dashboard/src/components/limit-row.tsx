import { Progress } from "@/components/ui/progress";
import { TONES } from "@/lib/colors";
import { formatResetAt, formatResetIn } from "@/lib/format";
import type { LimitWindow } from "@/lib/types";

export const LimitRow = ({
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
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="font-mono text-sm font-semibold">{pct}%</span>
      <Progress
        value={Math.min(100, pct)}
        className={`col-span-2 h-2 rounded-lg ${TONES.running.vars} ${TONES.running.bar}`}
      />
      <span className="text-muted-foreground col-span-2 text-right text-xs">
        {relative ? `Resets in ${formatResetIn(window.resetsAt - now)}` : `Resets ${formatResetAt(window.resetsAt)}`}
      </span>
    </div>
  );
};
