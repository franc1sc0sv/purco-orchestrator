import { Button } from "@/components/ui/button";
import { ticketHref } from "@/hooks/use-route";
import type { TicketSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export const AnswerNeeded = ({
  ticket,
  grill,
  className,
}: {
  ticket: string;
  grill: NonNullable<TicketSummary["awaitingGrill"]>;
  className?: string;
}) => (
  <div
    className={cn(
      "bg-blue-1 border-blue-3 relative z-10 mx-3 mb-3 flex items-center gap-3 rounded-lg border px-3 py-2",
      className,
    )}
  >
    <span className="bg-primary size-2 shrink-0 animate-soft-pulse rounded-full" />
    <span className="text-sm font-semibold">Your answer is needed</span>
    <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
      Q{grill.id} · {grill.question}
    </span>
    <Button asChild size="sm">
      <a href={ticketHref(ticket, "plan", { q: grill.id })}>Answer</a>
    </Button>
  </div>
);
