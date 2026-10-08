import { Fragment } from "react";
import { AnswerNeeded } from "@/components/answer-needed";
import { Counter } from "@/components/counter";
import { TicketRowsSkeleton } from "@/components/screen-skeleton";
import { RowStageBars } from "@/components/stage-bars";
import { SizeChip, StateText } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ticketHref } from "@/hooks/use-route";
import { formatCost, formatTokens } from "@/lib/format";
import {
  countByFilter,
  isTicketFilter,
  matchesFilter,
  type TicketFilter,
} from "@/lib/ticket-filter";
import type { TicketSummary } from "@/lib/types";

const COLUMNS = "grid grid-cols-[8rem_3rem_8rem_minmax(18rem,1fr)_5rem_5rem_4rem_6rem] items-center gap-4";

const TABS: { value: TicketFilter; label: string; empty: string }[] = [
  { value: "live", label: "Live", empty: "No live tickets" },
  { value: "failed", label: "Failed", empty: "No failed tickets" },
  { value: "completed", label: "Completed", empty: "No completed tickets" },
  { value: "not-recorded", label: "Not recorded", empty: "No tickets without recorded steps" },
  { value: "all", label: "All", empty: "No tickets" },
];

const selectFilter = (value: string) => {
  if (isTicketFilter(value)) window.location.replace(`#/?filter=${value}`);
};

const rank = (summary: TicketSummary): number => {
  if (summary.openItemCount > 0) return 0;
  return summary.state === "running" ? 1 : 2;
};

const TicketRow = ({ summary }: { summary: TicketSummary }) => (
  <div className="hover:bg-accent/40 focus-within:bg-accent/40 relative transition-colors">
    <div className={`${COLUMNS} px-3 py-3`}>
      <a
        href={ticketHref(summary.ticket, summary.state === "failed" ? "failures" : "live")}
        className="font-mono text-base font-semibold outline-none after:absolute after:inset-0 after:content-['']"
      >
        {summary.ticket}
      </a>
      <div>
        <SizeChip size={summary.size} />
      </div>
      <StateText state={summary.state} />
      <div className="relative py-3">
        <RowStageBars stages={summary.stages} />
      </div>
      <Counter value={summary.costUsd} format={formatCost} className="text-right font-mono text-sm" />
      <Counter value={summary.tokens} format={formatTokens} className="text-right font-mono text-sm" />
      <span className="text-right font-mono text-sm">{summary.liveAgents}</span>
      <div className="flex justify-end">
        {summary.openItemCount > 0 && summary.awaitingGrill === null ? (
          <Button asChild size="sm" className="relative z-10">
            <a href={ticketHref(summary.ticket, "live", { review: 1 })}>Review</a>
          </Button>
        ) : null}
      </div>
    </div>
    {summary.awaitingGrill ? <AnswerNeeded ticket={summary.ticket} grill={summary.awaitingGrill} /> : null}
  </div>
);

export const TicketsScreen = ({
  tickets,
  filter,
}: {
  tickets: TicketSummary[] | undefined;
  filter: TicketFilter;
}) => {
  if (!tickets) return <TicketRowsSkeleton />;
  if (tickets.length === 0) return <div className="text-muted-foreground p-10 text-center">no tickets found</div>;
  const counts = countByFilter(tickets);
  const visible = tickets
    .filter((summary) => matchesFilter(summary, filter))
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
  const empty = TABS.find((tab) => tab.value === filter)?.empty;
  return (
    <div className="flex flex-col gap-3">
      <Tabs value={filter} onValueChange={selectFilter}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              <span className="text-muted-foreground font-mono text-xs">{counts[tab.value]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div>
        <div className={`${COLUMNS} text-muted-foreground px-3 pb-2 text-xs`}>
          <span>Ticket</span>
          <span>Size</span>
          <span>State</span>
          <span>Stages</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Tokens</span>
          <span className="text-right">Agents</span>
          <span />
        </div>
        <Separator />
        {visible.length === 0 ? <p className="text-muted-foreground px-3 py-6 text-sm">{empty}</p> : null}
        {visible.map((summary) => (
          <Fragment key={summary.ticket}>
            <TicketRow summary={summary} />
            <Separator />
          </Fragment>
        ))}
      </div>
    </div>
  );
};
