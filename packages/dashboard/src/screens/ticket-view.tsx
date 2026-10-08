import { failedStepsOf } from "@/components/failed-steps";
import { ComingSoon } from "@/components/coming-soon";
import { Counter } from "@/components/counter";
import { DecisionTimeline } from "@/components/decision-timeline";
import { GateDialog } from "@/components/gate-dialog";
import { SizeChip, StateBadge } from "@/components/state-badge";
import { TicketSkeleton } from "@/components/screen-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGateDialog } from "@/hooks/use-gate-dialog";
import { useNotes } from "@/hooks/use-notes";
import { useReplayEvents } from "@/hooks/use-replay-events";
import { useNow } from "@/hooks/use-now";
import { TICKET_TABS, isTicketTab, ticketHref, type TicketTab } from "@/hooks/use-route";
import { detailAt, replayTimeOf } from "@/lib/replay";
import { formatCost, formatDuration, formatTokens } from "@/lib/format";
import { isGrillItem, type TicketDetail } from "@/lib/types";
import { FailuresTab } from "@/screens/failures-tab";
import { LiveTab } from "@/screens/live-tab";
import { FeedbackTab } from "@/screens/feedback-tab";
import { FilesTab } from "@/screens/files-tab";
import { PlanTab } from "@/screens/plan-tab";
import { TimelineTab } from "@/screens/timeline-tab";
import { StoryTab } from "@/screens/story-tab";
import { TestsTab } from "@/screens/tests-tab";

const Stat = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div className="grid">
    <span className="font-mono text-base leading-tight font-semibold">{children}</span>
    <span className="text-muted-foreground text-xs leading-tight">{label}</span>
  </div>
);

const DecisionSheet = ({ detail }: { detail: TicketDetail }) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button size="sm" variant="outline">
        Decisions ({detail.decisions.length})
      </Button>
    </SheetTrigger>
    <SheetContent>
      <SheetHeader>
        <SheetTitle>Decision log</SheetTitle>
        <SheetDescription>Every lead decision of {detail.summary.ticket}.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 px-4">
        <DecisionTimeline decisions={detail.decisions} />
      </div>
      <div className="p-4">
        <SheetClose asChild>
          <Button variant="secondary" className="w-full">
            Close
          </Button>
        </SheetClose>
      </div>
    </SheetContent>
  </Sheet>
);

const selectTab = (ticket: string, value: string, replay: string | null): void => {
  if (isTicketTab(value)) window.location.hash = ticketHref(ticket, value, replay ? { t: replay } : undefined);
};

const TAB_LABELS: Record<TicketTab, string> = {
  live: "Live",
  story: "Story",
  plan: "Plan",
  files: "Files",
  tests: "Tests",
  timeline: "Timeline",
  failures: "Failures",
  feedback: "Feedback",
};

const tabCount = (detail: TicketDetail, tab: TicketTab): string | null => {
  if (tab === "plan" && detail.grill.questions.length > 0) return `${detail.grill.questions.length} Q`;
  if (tab === "tests" && detail.tests.mutants.length > 0) return String(detail.tests.mutants.length);
  if (tab === "failures") {
    const failed = failedStepsOf(detail.pipeline).length;
    return failed > 0 ? String(failed) : null;
  }
  return null;
};

const TabStrip = ({ detail, tab, replay }: { detail: TicketDetail; tab: TicketTab; replay: string | null }) => {
  const { notes } = useNotes(detail.summary.ticket);
  const open = notes.filter((note) => note.status !== "applied").length;
  const countOf = (key: TicketTab): string | null => {
    if (key === "feedback") return open > 0 ? String(open) : null;
    return tabCount(detail, key);
  };
  return (
    <Tabs value={tab} onValueChange={(value) => selectTab(detail.summary.ticket, value, replay)}>
      <TabsList>
        {TICKET_TABS.map((key) => (
          <TabsTrigger key={key} value={key}>
            {TAB_LABELS[key]}
            {countOf(key) ? <span className="text-muted-foreground font-mono text-xs">{countOf(key)}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};

const TabBody = ({
  detail,
  tab,
  params,
  items,
  now,
  onReview,
}: {
  detail: TicketDetail;
  tab: TicketTab;
  params: URLSearchParams;
  items: TicketDetail["items"];
  now: number;
  onReview: () => void;
}) => {
  if (tab === "plan") return <PlanTab detail={detail} selected={Number(params.get("q"))} />;
  if (tab === "tests") {
    const mutant = params.get("mutant");
    return <TestsTab detail={detail} selected={mutant === null ? null : Number(mutant)} />;
  }
  if (tab === "live") {
    return (
      <LiveTab
        detail={detail}
        items={items}
        now={now}
        agentId={params.get("agent")}
        replay={params.get("t")}
        onReview={onReview}
      />
    );
  }
  if (tab === "timeline") return <TimelineTab detail={detail} now={now} playhead={replayTimeOf(params)} />;
  if (tab === "story") return <StoryTab ticket={detail.summary.ticket} />;
  if (tab === "failures") return <FailuresTab ticket={detail.summary.ticket} />;
  if (tab === "files") return <FilesTab ticket={detail.summary.ticket} selected={params.get("file")} />;
  if (tab === "feedback") return <FeedbackTab ticket={detail.summary.ticket} />;
  return <ComingSoon title={TAB_LABELS[tab]} />;
};

export const TicketView = ({
  detail,
  tab,
  params,
  review,
}: {
  detail: TicketDetail | undefined;
  tab: TicketTab;
  params: URLSearchParams;
  review: number;
}) => {
  const now = useNow(1000);
  const items = detail?.items.filter((candidate) => !isGrillItem(candidate)) ?? [];
  const item = items[0];
  const dialog = useGateDialog(item?.id, review);
  const replayAt = replayTimeOf(params);
  const replayEvents = useReplayEvents(detail?.summary.ticket ?? "", replayAt);
  if (!detail) return <TicketSkeleton />;
  const shown =
    tab === "live" && replayAt !== null
      ? detailAt(
          detail,
          replayAt,
          replayEvents ?? detail.events.filter((event) => Date.parse(event.at) <= replayAt),
        )
      : detail;
  const { summary } = detail;
  const running = summary.endedAt === null;
  const elapsed = running && summary.startedAt ? now - Date.parse(summary.startedAt) : summary.elapsedMs;
  return (
    <div className="grid size-full grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-3">
      <Card className="gap-0 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
              <a href="#/">tickets</a>
            </Button>
            <span className="font-mono text-xl font-semibold">{summary.ticket}</span>
            <SizeChip size={summary.size} />
            <StateBadge state={summary.state} />
          </div>
          <div className="flex items-center gap-5">
            <Stat label="cost">
              <Counter value={summary.costUsd} format={formatCost} />
            </Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="tokens">
              <Counter value={summary.tokens} format={formatTokens} />
            </Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="elapsed">{formatDuration(Math.max(0, elapsed))}</Stat>
            <Separator orientation="vertical" className="h-8" />
            <Stat label="agents">{summary.liveAgents}</Stat>
            <DecisionSheet detail={detail} />
          </div>
        </div>
      </Card>
      <TabStrip detail={detail} tab={tab} replay={params.get("t")} />
      <TabBody
        detail={shown}
        tab={tab}
        params={params}
        items={items}
        now={now}
        onReview={() => dialog.setOpen(true)}
      />
      {item ? (
        <GateDialog
          key={item.id}
          ticket={summary.ticket}
          item={item}
          open={dialog.open}
          onOpenChange={dialog.setOpen}
        />
      ) : null}
    </div>
  );
};
