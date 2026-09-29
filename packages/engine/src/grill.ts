import fs from "node:fs";
import path from "node:path";

export type GrillOption = { label: string; consequence?: string };

export type GrillQuestion = {
  id: number;
  question: string;
  whyOpen?: string;
  evidence?: string;
  options: GrillOption[];
  dependsOn: number[];
  recommended?: string;
  blocking: boolean;
};

export type GrillResult = {
  asked: number;
  answered: number;
  parked: number;
  assumed: number;
  settledByLead: number;
};

export type GrillDeps = {
  pack: string;
  ask: (text: string) => Promise<string | undefined>;
  prune: (
    answered: GrillQuestion,
    answer: string,
    remaining: GrillQuestion[],
  ) => Promise<{ settled: number[]; reason: string }>;
};

const QUESTIONS_FILE = "02a-open-questions.json";
const DECISIONS_FILE = "03-decisions.md";

const asQuestion = (raw: unknown): GrillQuestion | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "number" || typeof value.question !== "string") {
    return undefined;
  }
  const options = Array.isArray(value.options)
    ? value.options
        .map((option) =>
          typeof option === "string"
            ? { label: option }
            : typeof option === "object" && option !== null
              ? {
                  label: String((option as { label?: unknown }).label ?? ""),
                  consequence:
                    typeof (option as { consequence?: unknown }).consequence ===
                    "string"
                      ? String((option as { consequence: string }).consequence)
                      : undefined,
                }
              : undefined,
        )
        .filter((option): option is GrillOption => Boolean(option?.label))
    : [];
  return {
    id: value.id,
    question: value.question,
    whyOpen: typeof value.whyOpen === "string" ? value.whyOpen : undefined,
    evidence: typeof value.evidence === "string" ? value.evidence : undefined,
    options,
    dependsOn: Array.isArray(value.dependsOn)
      ? value.dependsOn.filter((id): id is number => typeof id === "number")
      : [],
    recommended:
      typeof value.recommended === "string" ? value.recommended : undefined,
    blocking: value.blocking !== false,
  };
};

export const readGrillQuestions = (pack: string): GrillQuestion[] | undefined => {
  const file = path.join(pack, QUESTIONS_FILE);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
      questions?: unknown[];
    };
    return (parsed.questions ?? [])
      .map(asQuestion)
      .filter((question): question is GrillQuestion => Boolean(question));
  } catch {
    return undefined;
  }
};

export const formatGrillQuestion = (
  question: GrillQuestion,
  position: number,
  total: number,
): string =>
  [
    `Grill question ${position} of ${total} (Q${question.id})`,
    "",
    question.question,
    question.whyOpen ? `\nWhy it is open: ${question.whyOpen}` : "",
    question.evidence ? `Evidence: ${question.evidence}` : "",
    "",
    "Options:",
    ...question.options.map(
      (option, index) =>
        `  ${String.fromCharCode(97 + index)}) ${option.label}${option.consequence ? ` — ${option.consequence}` : ""}`,
    ),
    question.recommended ? `\nRecommended: ${question.recommended}` : "",
    "",
    'Reply with an option or in your own words. Reply "park" to leave it open; the plan step does not start while a question is parked.',
  ]
    .filter((line) => line !== "")
    .join("\n");

const isPark = (answer: string): boolean => /^\s*park\b/i.test(answer);

const today = (): string => new Date().toISOString().slice(0, 10);

const decisionWriter = (pack: string): ((line: string) => void) => {
  const file = path.join(pack, DECISIONS_FILE);
  let started = false;
  return (line) => {
    if (!started) {
      const header = fs.existsSync(file) ? "" : "# Decisions\n";
      fs.appendFileSync(file, `${header}\n## Grill ${today()}\n\n`);
      started = true;
    }
    fs.appendFileSync(file, `${line}\n`);
  };
};

const recordedIds = (pack: string): Set<number> => {
  const file = path.join(pack, DECISIONS_FILE);
  if (!fs.existsSync(file)) return new Set();
  const ids = [...fs.readFileSync(file, "utf8").matchAll(/^\s*- (?:\[ \] )?Q(\d+) /gm)];
  return new Set(ids.map((match) => Number(match[1])));
};

export const runGrill = async (deps: GrillDeps): Promise<GrillResult | undefined> => {
  const questions = readGrillQuestions(deps.pack);
  if (!questions) return undefined;

  const result: GrillResult = {
    asked: 0,
    answered: 0,
    parked: 0,
    assumed: 0,
    settledByLead: 0,
  };
  const write = decisionWriter(deps.pack);
  const closed = recordedIds(deps.pack);
  const blocking = questions.filter((question) => question.blocking);

  for (const question of questions.filter(
    (q) => !q.blocking && !closed.has(q.id),
  )) {
    write(
      `- Q${question.id} ${question.question} — assumed: ${question.recommended ?? "the inquisitor's recommendation"} (not blocking)`,
    );
    closed.add(question.id);
    result.assumed += 1;
  }

  for (const question of blocking) {
    if (closed.has(question.id)) continue;
    closed.add(question.id);
    result.asked += 1;
    const answer = await deps.ask(
      formatGrillQuestion(question, result.asked, blocking.length),
    );
    if (!answer || isPark(answer)) {
      write(`- [ ] Q${question.id} ${question.question}`);
      result.parked += 1;
      continue;
    }
    write(`- Q${question.id} ${question.question} — ${answer.trim()} (human, ${today()})`);
    result.answered += 1;

    const remaining = blocking.filter((q) => !closed.has(q.id));
    if (remaining.length === 0) continue;
    const pruned = await deps.prune(question, answer, remaining);
    for (const id of pruned.settled) {
      const settled = remaining.find((q) => q.id === id);
      if (!settled) continue;
      closed.add(id);
      write(
        `- Q${id} ${settled.question} — settled by the answer to Q${question.id}: ${pruned.reason}`,
      );
      result.settledByLead += 1;
    }
  }

  return result;
};
