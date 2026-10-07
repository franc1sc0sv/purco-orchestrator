import { ToneBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { KIND_LABEL } from "@/components/gate-dialog";
import { clock } from "@/lib/format";
import type { OpenItem } from "@/lib/types";

export const GatePanel = ({
  item,
  count,
  onReview,
}: {
  item: OpenItem;
  count: number;
  onReview: () => void;
}) => (
  <div className="flex size-full flex-col justify-between gap-2">
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <ToneBadge tone="waiting" pulse>
          {KIND_LABEL[item.kind] ?? item.kind} waiting
        </ToneBadge>
        <span className="text-muted-foreground truncate font-mono text-xs">{item.from}</span>
        <span className="text-muted-foreground ml-auto font-mono text-xs">{clock(item.at)}</span>
      </div>
      <div className="text-muted-foreground text-xs">
        {count > 1 ? `${count} items wait for you.` : "One item waits for you."}
      </div>
    </div>
    <Button size="sm" onClick={onReview}>
      Review
    </Button>
  </div>
);
