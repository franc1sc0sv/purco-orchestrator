import { lazy, Suspense, useState, type ReactNode } from "react";
import { PanelSkeleton } from "@/components/screen-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { answerEarly, answerItem } from "@/lib/api";
import { chosenOption, optionLetter, recommendedOption } from "@/lib/grill-tree";
import type { GrillOption, GrillQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

const GrillDiagram = lazy(() =>
  import("@/components/grill-diagram").then((module) => ({ default: module.GrillDiagram })),
);

const Heading = ({ children }: { children: string }) => (
  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{children}</h3>
);

const provenance = (question: GrillQuestion): string | null => {
  if (question.status !== "answered" && question.status !== "parked") return null;
  if (question.early) return "Answered early in the dashboard";
  if (question.answeredVia === "dashboard") return "Answered in the dashboard";
  if (question.answeredVia === "cli") return "Answered in the Claude session";
  return null;
};

const OptionCard = ({
  option,
  index,
  recommended,
  chosen,
  selected,
  interactive,
  onPick,
}: {
  option: GrillOption;
  index: number;
  recommended: boolean;
  chosen: boolean;
  selected: boolean;
  interactive: boolean;
  onPick: () => void;
}) => (
  <button
    type="button"
    disabled={!interactive}
    onClick={onPick}
    className={cn(
      "grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
      interactive && "hover:bg-accent/60 cursor-pointer",
      (chosen || selected) && "border-primary bg-blue-1 border-2",
    )}
  >
    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
      {optionLetter(index)} · {option.label}
      {chosen ? <Badge>your answer</Badge> : null}
      {recommended ? <Badge variant="secondary">recommended</Badge> : null}
    </span>
    {option.consequence ? <span className="text-muted-foreground text-sm">{option.consequence}</span> : null}
    {option.example ? (
      <span className="text-sm">
        <span className="text-muted-foreground">With this option: </span>
        {option.example}
      </span>
    ) : null}
  </button>
);

type AnswerState = "idle" | "sending" | "failed" | "taken";

const AnswerBox = ({
  ticket,
  question,
  draft,
  onDraft,
}: {
  ticket: string;
  question: GrillQuestion;
  draft: string;
  onDraft: (value: string) => void;
}) => {
  const [state, setState] = useState<AnswerState>("idle");

  const send = async (text: string): Promise<void> => {
    setState("sending");
    const outcome =
      question.itemId === null
        ? await answerEarly(ticket, question.id, text)
        : await answerItem(ticket, question.itemId, text);
    setState(outcome === "answered" ? "idle" : outcome === "failed" ? "failed" : "taken");
    if (outcome === "answered") onDraft("");
  };

  return (
    <div className="bg-card grid gap-2 border-t p-4">
      <Textarea
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder="Pick an option or write your own answer"
        className="min-h-16 resize-none"
        rows={2}
      />
      {state === "failed" ? <p className="text-sm">The answer was not saved. Try again.</p> : null}
      {state === "taken" ? <p className="text-sm">This question was already answered.</p> : null}
      <div className="flex gap-2">
        <Button disabled={draft.trim().length === 0 || state === "sending"} onClick={() => void send(draft.trim())}>
          {question.itemId === null ? "Answer early" : "Answer"}
        </Button>
        <Button variant="outline" disabled={state === "sending"} onClick={() => void send("park")}>
          Park
        </Button>
      </div>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="grid gap-1">
    <Heading>{title}</Heading>
    {children}
  </div>
);

export const GrillAnswerPanel = ({ ticket, question }: { ticket: string; question: GrillQuestion }) => {
  const [draft, setDraft] = useState("");
  const answerable = question.status === "open" || question.status === "upcoming";
  const chosen = chosenOption(question);
  const recommended = recommendedOption(question);
  const source = provenance(question);
  return (
    <div className="flex size-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-4 p-4">
          <div className="grid gap-1">
            <Heading>{`Q${question.id}`}</Heading>
            <h2 className="text-base font-semibold">{question.question}</h2>
            {source ? <p className="text-primary text-sm">{source}</p> : null}
            {question.status === "upcoming" ? (
              <p className="text-muted-foreground text-sm">Not asked yet. You can answer it now.</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            {question.options.map((option, index) => (
              <OptionCard
                key={option.label}
                option={option}
                index={index}
                recommended={recommended?.label === option.label}
                chosen={chosen?.label === option.label}
                selected={answerable && draft === option.label}
                interactive={answerable}
                onPick={() => setDraft(option.label)}
              />
            ))}
            {question.answer !== null && !chosen ? (
              <p className="rounded-lg border-2 border-primary bg-blue-1 px-3 py-2 text-sm">
                <span className="font-semibold">Your answer: </span>
                {question.answer}
              </p>
            ) : null}
          </div>
          {question.recommended ? (
            <p className="text-muted-foreground text-sm">
              <span className="font-semibold">Recommended: </span>
              {question.recommended}
            </p>
          ) : null}
          {question.example ? (
            <Section title="Example">
              <p className="bg-muted rounded-lg px-3 py-2 font-mono text-xs">{question.example}</p>
            </Section>
          ) : null}
          {question.diagram ? (
            <Suspense fallback={<PanelSkeleton />}>
              <GrillDiagram diagram={question.diagram} />
            </Suspense>
          ) : null}
          {question.explain ? (
            <Section title="How it works today">
              <p className="text-sm">{question.explain}</p>
            </Section>
          ) : null}
          {question.whyOpen ? (
            <Section title="Why it is open">
              <p className="text-muted-foreground text-sm">
                {question.whyOpen}
                {question.evidence ? <span className="font-mono"> {question.evidence}</span> : null}
              </p>
            </Section>
          ) : null}
        </div>
      </ScrollArea>
      {answerable ? <AnswerBox key={question.id} ticket={ticket} question={question} draft={draft} onDraft={setDraft} /> : null}
    </div>
  );
};
