import { lazy, Suspense } from "react";
import { TicketSkeleton } from "@/components/screen-skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAlertNotifier } from "@/hooks/use-alert-notifier";
import { useRoute } from "@/hooks/use-route";
import { useStream, type StreamStatus } from "@/hooks/use-stream";
import { TONES, type Tone } from "@/lib/colors";
import { applyDelta } from "@/lib/apply-delta";
import type { TicketDelta, TicketDetail, TicketSummary, UsageSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HistoryScreen } from "@/screens/history";
import { TicketsScreen } from "@/screens/tickets";
import { UsageScreen } from "@/screens/usage";
import { UsageStrip } from "@/components/usage-strip";

const TicketView = lazy(() =>
  import("@/screens/ticket-view").then((module) => ({ default: module.TicketView })),
);

type ListSnapshot = { tickets: TicketSummary[]; usage?: UsageSnapshot };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isList = (value: unknown): value is ListSnapshot =>
  isRecord(value) && Array.isArray(value.tickets);

const isDetail = (value: unknown): value is TicketDetail =>
  isRecord(value) && isRecord(value.summary) && Array.isArray(value.pipeline);

const isDelta = (value: unknown): value is TicketDelta =>
  isRecord(value) && Array.isArray(value.events) && Array.isArray(value.samples);

const DETAIL_MERGE = { acceptDelta: isDelta, apply: applyDelta };

const STATUS_TONE: Record<StreamStatus, Tone> = {
  connecting: "waiting",
  live: "done",
  lost: "stuck",
};

const NavLink = ({ href, active, children }: { href: string; active: boolean; children: string }) => (
  <Button asChild variant={active ? "secondary" : "ghost"} size="sm">
    <a href={href}>{children}</a>
  </Button>
);

export const App = () => {
  const route = useRoute();
  const list = useStream<ListSnapshot>(null, isList);
  const detail = useStream<TicketDetail, TicketDelta>(
    route.name === "ticket" ? route.ticket : null,
    isDetail,
    DETAIL_MERGE,
  );
  useAlertNotifier(list.data?.tickets);
  const status = route.name === "ticket" ? detail.status : list.status;

  return (
    <TooltipProvider>
      <div className="mx-auto grid h-dvh max-w-[1920px] grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden p-4">
        <header className="flex items-center justify-between gap-4">
          <nav className="flex gap-1">
            <NavLink href="#/" active={route.name === "tickets" || route.name === "ticket"}>
              Tickets
            </NavLink>
            <NavLink href="#/history" active={route.name === "history"}>
              History
            </NavLink>
            <NavLink href="#/usage" active={route.name === "usage"}>
              Usage
            </NavLink>
          </nav>
          <div className="flex items-center gap-4">
            <UsageStrip usage={list.data?.usage} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("size-2.5 rounded-full", TONES[STATUS_TONE[status]].vars, TONES[STATUS_TONE[status]].dot)} />
              </TooltipTrigger>
              <TooltipContent>{status}</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main className="min-h-0">
          {route.name === "tickets" ? (
            <ScrollArea className="h-full">
              <TicketsScreen tickets={list.data?.tickets} filter={route.filter} />
            </ScrollArea>
          ) : null}
          {route.name === "ticket" ? (
            <Suspense fallback={<TicketSkeleton />}>
              <TicketView detail={detail.data} tab={route.tab} params={route.params} review={route.review} />
            </Suspense>
          ) : null}
          {route.name === "history" ? (
            <ScrollArea className="h-full">
              <HistoryScreen />
            </ScrollArea>
          ) : null}
          {route.name === "usage" ? (
            <ScrollArea className="h-full">
              <UsageScreen usage={list.data?.usage} />
            </ScrollArea>
          ) : null}
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
};
