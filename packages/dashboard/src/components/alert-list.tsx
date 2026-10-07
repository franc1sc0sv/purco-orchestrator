import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jsonPostHeaders } from "@/lib/api";
import { clock } from "@/lib/format";
import type { Alert } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOOLTIP_DELAY_MS = 300;

const markSeen = async (ticket: string, ids: number[]): Promise<void> => {
  try {
    await fetch(`/api/tickets/${encodeURIComponent(ticket)}/alerts/seen`, {
      method: "POST",
      headers: jsonPostHeaders(),
      body: JSON.stringify({ ids }),
    });
  } catch {
    return;
  }
};

const AlertRow = ({
  alert,
  unseen,
  onOpen,
  onReview,
}: {
  alert: Alert;
  unseen: boolean;
  onOpen: () => void;
  onReview: (() => void) | undefined;
}) => {
  const reviews = alert.kind === "gate" && onReview !== undefined;
  const row = (
    <button
      type="button"
      onClick={() => {
        onOpen();
        if (reviews) onReview();
      }}
      className={cn(
        "hover:bg-accent flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
        !unseen && "opacity-60",
      )}
    >
      <Badge
        variant={unseen ? "default" : "secondary"}
        className={cn("w-[4.5rem] shrink-0 px-1.5 py-0 text-xs", !unseen && "text-muted-foreground")}
      >
        {alert.kind}
      </Badge>
      <span className={cn("min-w-0 flex-1 truncate", unseen && "font-medium")}>{alert.title}</span>
      <span className="text-muted-foreground shrink-0 font-mono text-xs">{clock(alert.at)}</span>
    </button>
  );
  const tip = (
    <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent
        side="left"
        className="max-h-64 max-w-sm overflow-y-auto text-left break-words whitespace-pre-wrap"
      >
        {alert.message}
      </TooltipContent>
    </Tooltip>
  );
  if (reviews) return tip;
  return (
    <Popover>
      <PopoverTrigger asChild>{tip}</PopoverTrigger>
      <PopoverContent side="left" className="max-h-80 w-96 overflow-y-auto text-sm break-words whitespace-pre-wrap">
        {alert.message}
      </PopoverContent>
    </Popover>
  );
};

export const AlertList = ({ alerts, onReview }: { alerts: Alert[]; onReview?: () => void }) => {
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [acknowledged, setAcknowledged] = useState<Set<number>>(new Set());
  const known = useRef(new Set<number>());

  useEffect(() => {
    const incoming = alerts.filter((alert) => alert.seen === 0 && !known.current.has(alert.id));
    if (incoming.length === 0) return;
    for (const alert of incoming) known.current.add(alert.id);
    setFresh((current) => new Set([...current, ...incoming.map((alert) => alert.id)]));
  }, [alerts]);

  if (alerts.length === 0) {
    return <div className="text-muted-foreground flex size-full items-center justify-center text-sm">no alerts</div>;
  }

  const isUnseen = (alert: Alert): boolean =>
    (alert.seen === 0 || fresh.has(alert.id)) && !acknowledged.has(alert.id);
  const unseenCount = alerts.filter(isUnseen).length;

  const acknowledge = (target: Alert[]): void => {
    setAcknowledged((current) => new Set([...current, ...target.map((alert) => alert.id)]));
    const pending = target.filter((alert) => alert.seen === 0);
    const [first] = pending;
    if (first) void markSeen(first.ticket, pending.map((alert) => alert.id));
  };

  return (
    <div className="flex size-full min-h-0 flex-col gap-1">
      <div className="flex shrink-0 justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-6 px-2 text-xs"
          disabled={unseenCount === 0}
          onClick={() => acknowledge(alerts)}
        >
          Mark all seen
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="grid">
          {[...alerts].reverse().map((alert) => (
            <li key={alert.id}>
              <AlertRow
                alert={alert}
                unseen={isUnseen(alert)}
                onOpen={() => acknowledge([alert])}
                onReview={onReview}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
};
