import { lazy, Suspense } from "react";
import { PanelSkeleton } from "@/components/screen-skeleton";
import { CountStat } from "@/components/count-stat";
import { ToneBadge } from "@/components/state-badge";
import { Card } from "@/components/ui/card";
import { ticketHref } from "@/hooks/use-route";
import { STEP_TONE } from "@/lib/colors";
import { changedRecommendation } from "@/lib/grill-tree";
import type { GrillQuestion, PipelineStep, TicketDetail } from "@/lib/types";

const GrillTree = lazy(() =>
  import("@/components/grill-tree").then((module) => ({ default: module.GrillTree })),
);
const GrillAnswerPanel = lazy(() =>
  import("@/components/grill-answer-panel").then((module) => ({ default: module.GrillAnswerPanel })),
);

const CHIPS = ["intake", "grill", "plan"] as const;

const stepOf = (steps: PipelineStep[], baseKey: string): PipelineStep | undefined =>
  steps.filter((step) => step.baseKey === baseKey).pop();

const Chips = ({ detail }: { detail: TicketDetail }) => {
  const steps = detail.pipeline.find((stage) => stage.stage === "plan")?.steps ?? [];
  return (
    <div className="flex items-center gap-2">
      {CHIPS.map((key, index) => {
        const step = stepOf(steps, key);
        return (
          <div key={key} className="flex items-center gap-2">
            {index > 0 ? <span className="text-muted-foreground text-sm">→</span> : null}
            <ToneBadge tone={step ? STEP_TONE[step.status] : "pending"} pulse={step?.status === "running"}>
              {key}
            </ToneBadge>
          </div>
        );
      })}
    </div>
  );
};

const pickQuestion = (questions: GrillQuestion[], selected: number): GrillQuestion | undefined =>
  questions.find((question) => question.id === selected) ??
  questions.find((question) => question.status === "open") ??
  questions[0];

export const PlanTab = ({ detail, selected }: { detail: TicketDetail; selected: number }) => {
  const { questions } = detail.grill;
  const { ticket } = detail.summary;
  const current = pickQuestion(questions, selected);
  const answered = questions.filter((question) => question.status === "answered").length;
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Chips detail={detail} />
        <div className="flex gap-6">
          <CountStat value={questions.length} label="questions" />
          <CountStat value={answered} label="answered" />
          <CountStat value={questions.filter(changedRecommendation).length} label="changed by you" />
        </div>
      </div>
      {current === undefined ? (
        <Card className="text-muted-foreground flex-1 items-center justify-center text-sm">
          The grill has no questions yet.
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,36%)] gap-3">
          <Card className="min-h-0 gap-2 py-3">
            <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">
              Grill decision tree · each answer opens the next branch
            </h2>
            <div className="min-h-0 flex-1">
              <Suspense fallback={<PanelSkeleton />}>
                <GrillTree
                  questions={questions}
                  selectedId={current.id}
                  onSelect={(id) => {
                    window.location.hash = ticketHref(ticket, "plan", { q: id });
                  }}
                />
              </Suspense>
            </div>
            <p className="text-muted-foreground px-4 text-xs">
              YOU = you changed the recommendation. Plain = you accepted the recommendation.
            </p>
          </Card>
          <Card className="min-h-0 gap-0 overflow-hidden py-0">
            <Suspense fallback={<PanelSkeleton />}>
              <GrillAnswerPanel key={current.id} ticket={ticket} question={current} />
            </Suspense>
          </Card>
        </div>
      )}
    </div>
  );
};
