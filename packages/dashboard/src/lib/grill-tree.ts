import type { GrillOption, GrillQuestion } from "@/lib/types";

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 88;
const LEVEL_GAP = 56;
const SIBLING_GAP = 28;
const TITLE_LENGTH = 60;

export type Placed = { question: GrillQuestion; x: number; y: number };

const depthsOf = (questions: GrillQuestion[]): Map<number, number> => {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const depths = new Map<number, number>();
  const depthOf = (id: number, seen: Set<number>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const question = byId.get(id);
    if (!question || seen.has(id)) return 0;
    const parents = question.dependsOn.filter((parent) => byId.has(parent));
    const depth =
      parents.length === 0 ? 0 : 1 + Math.max(...parents.map((parent) => depthOf(parent, new Set([...seen, id]))));
    depths.set(id, depth);
    return depth;
  };
  for (const question of questions) depthOf(question.id, new Set());
  return depths;
};

export const placeQuestions = (questions: GrillQuestion[]): Placed[] => {
  const depths = depthsOf(questions);
  const columns = new Map<number, GrillQuestion[]>();
  for (const question of questions) {
    const depth = depths.get(question.id) ?? 0;
    columns.set(depth, [...(columns.get(depth) ?? []), question]);
  }
  const widest = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const width = widest * (NODE_WIDTH + SIBLING_GAP);
  return [...columns.entries()].flatMap(([depth, column]) => {
    const offset = (width - column.length * (NODE_WIDTH + SIBLING_GAP)) / 2;
    return column.map((question, index) => ({
      question,
      x: offset + index * (NODE_WIDTH + SIBLING_GAP),
      y: depth * (NODE_HEIGHT + LEVEL_GAP),
    }));
  });
};

export const clip = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

export const shortQuestion = (question: GrillQuestion): string => clip(question.question, TITLE_LENGTH);

export const optionLetter = (index: number): string => String.fromCharCode(65 + index);

const normalise = (text: string): string => text.trim().toLowerCase();

export const recommendedOption = (question: GrillQuestion): GrillOption | undefined => {
  const recommended = normalise(question.recommended ?? "");
  if (recommended === "") return undefined;
  return [...question.options]
    .sort((a, b) => b.label.length - a.label.length)
    .find((option) => recommended.includes(normalise(option.label)));
};

export const chosenOption = (question: GrillQuestion): GrillOption | undefined => {
  const answer = normalise(question.answer ?? "");
  return question.options.find((option) => answer === normalise(option.label));
};

export const changedRecommendation = (question: GrillQuestion): boolean => {
  if (question.status !== "answered" || question.answer === null) return false;
  const recommended = recommendedOption(question);
  if (!recommended) return false;
  return !normalise(question.answer).startsWith(normalise(recommended.label));
};
