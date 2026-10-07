import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useNow } from "@/hooks/use-now";
import { TONES } from "@/lib/colors";
import { formatCost, formatCountdown, formatTokens } from "@/lib/format";
import type { UsageSnapshot } from "@/lib/types";

const BLOCK_MS = 5 * 60 * 60 * 1000;

const Figure = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <span className="flex items-baseline gap-1.5">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="font-mono text-xs font-medium">{children}</span>
  </span>
);

export const UsageStrip = ({ usage }: { usage: UsageSnapshot | undefined }) => {
  const now = useNow(15_000);
  if (!usage?.ready) {
    return <span className="text-muted-foreground text-xs">reading usage</span>;
  }
  const { block } = usage;
  const remaining = block ? Math.max(0, Date.parse(block.endsAt) - now) : 0;
  const elapsed = block ? Math.min(100, Math.round(((BLOCK_MS - remaining) / BLOCK_MS) * 100)) : 0;
  return (
    <a href="#/usage" className="flex items-center gap-3 rounded-md px-2 py-1 outline-none hover:bg-accent/40">
      <span className="text-muted-foreground text-xs font-medium uppercase">5h block</span>
      {block ? (
        <>
          <Figure label="tokens">{formatTokens(block.totals.tokens)}</Figure>
          <Figure label="cost">{formatCost(block.totals.costUsd)}</Figure>
          <Figure label="resets in">{formatCountdown(remaining)}</Figure>
          <Progress value={elapsed} className={`h-1.5 w-20 rounded-full ${TONES.running.vars} ${TONES.running.bar}`} />
        </>
      ) : (
        <span className="text-muted-foreground text-xs">no active block</span>
      )}
      <Separator orientation="vertical" className="h-4" />
      <span className="text-muted-foreground text-xs font-medium uppercase">week</span>
      <Figure label="tokens">{formatTokens(usage.rolling.tokens)}</Figure>
      <Figure label="cost">{formatCost(usage.rolling.costUsd)}</Figure>
    </a>
  );
};
