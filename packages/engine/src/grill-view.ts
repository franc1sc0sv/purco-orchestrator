import fs from "node:fs";
import path from "node:path";
import { readGrillQuestions, type GrillQuestion } from "./grill.ts";
import type { StoredEarlyAnswer, StoredGrillItem } from "./store.ts";

export type GrillStatus = "open" | "upcoming" | "answered" | "parked" | "settled" | "assumed";

export type GrillQuestionView = GrillQuestion & {
  status: GrillStatus;
  itemId: string | null;
  answer: string | null;
  answeredVia: "dashboard" | "cli" | null;
  early: boolean;
};

export type GrillView = { questions: GrillQuestionView[] };

const DECISIONS_FILE = "03-decisions.md";

const isPark = (answer: string): boolean => /^\s*park\b/i.test(answer);

const decisionLines = (pack: string): string[] => {
  const file = path.join(pack, DECISIONS_FILE);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
};

const lineFor = (lines: string[], id: number): string | undefined =>
  lines.find((line) => new RegExp(`^\\s*- (?:\\[ \\] )?Q${id} `).test(line));

const recordedAnswer = (line: string): string | undefined =>
  /—\s(.+)\s\(human, [\d-]+\)\s*$/.exec(line)?.[1];

const itemQuestionId = (item: StoredGrillItem): number | undefined => {
  const payload = item.payload;
  return typeof payload === "object" && payload !== null && "id" in payload && typeof payload.id === "number"
    ? payload.id
    : undefined;
};

const viaOf = (item: StoredGrillItem): "dashboard" | "cli" =>
  item.answeredVia === "dashboard" || item.answeredBy === "dashboard" ? "dashboard" : "cli";

const answeredView = (
  question: GrillQuestion,
  answer: string,
  extra: Pick<GrillQuestionView, "itemId" | "answeredVia" | "early">,
): GrillQuestionView => ({
  ...question,
  status: isPark(answer) ? "parked" : "answered",
  answer,
  ...extra,
});

const viewOf = (
  question: GrillQuestion,
  items: StoredGrillItem[],
  early: StoredEarlyAnswer[],
  lines: string[],
): GrillQuestionView => {
  const blank = { itemId: null, answer: null, answeredVia: null, early: false };
  const item = items.filter((candidate) => itemQuestionId(candidate) === question.id).pop();
  if (item?.answeredAt && item.answer !== null) {
    return answeredView(question, item.answer, { itemId: item.id, answeredVia: viaOf(item), early: false });
  }
  if (item) return { ...question, status: "open", ...blank, itemId: item.id };
  const line = lineFor(lines, question.id);
  const earlyAnswer = early.find((candidate) => candidate.qid === question.id);
  const recorded = line ? recordedAnswer(line) : undefined;
  if (line?.includes("settled by the answer to")) return { ...question, status: "settled", ...blank };
  if (line?.includes("(not blocking)")) return { ...question, status: "assumed", ...blank };
  if (line?.includes("[ ]")) return { ...question, status: "parked", ...blank };
  if (earlyAnswer) {
    return answeredView(question, earlyAnswer.answer, { itemId: null, answeredVia: "dashboard", early: true });
  }
  if (recorded) return answeredView(question, recorded, { itemId: null, answeredVia: null, early: false });
  return { ...question, status: "upcoming", ...blank };
};

export const buildGrillView = (input: {
  pack: string;
  items: StoredGrillItem[];
  early: StoredEarlyAnswer[];
}): GrillView => {
  const questions = readGrillQuestions(input.pack) ?? [];
  const lines = decisionLines(input.pack);
  return { questions: questions.map((question) => viewOf(question, input.items, input.early, lines)) };
};
