import fs from "node:fs";
import path from "node:path";
import type { Store, StoredStep } from "./store.ts";
import { stageOfKey } from "./types.ts";

const SUBJECT_PATTERNS: RegExp[] = [
  /(?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z0-9]{1,5}\b/g,
  /\b[\w-]+\.(?:tsx?|sql|prisma)\b/g,
  /\bFEATURE_FLAGS\.[A-Z][A-Z0-9_]*\b/g,
  /\b(?:backend|frontend|shared)-[a-z0-9]+(?:-[a-z0-9]+)*\b/g,
  /\bRULE-\d+\b/g,
  /\b(?:intake|grill|plan|build|static|test|verify|record|review)(?::[\w.-]+)+(?:#\d+)?/g,
];

const FLAG_NAME = /^FEATURE_FLAGS\.(.+)$/;

export const extractSubjects = (text: string): string[] => {
  const found = new Set<string>();
  for (const pattern of SUBJECT_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[0]);
  }
  for (const subject of [...found]) {
    const name = FLAG_NAME.exec(subject)?.[1];
    if (name) found.add(name);
  }
  const stepLine = /^Step:\s*(\S+)/m.exec(text)?.[1];
  if (stepLine && /[:#]/.test(stepLine)) found.add(stepLine);
  return [...found];
};

const DECISION_LINE = /^\s*(?:[-*]|\d+[.)])\s+/;
const OPEN_LINE = /\[ \]/;

export const settledDecisionLines = (
  decisionsText: string,
  subjects: string[],
): string[] =>
  decisionsText
    .split("\n")
    .filter((line) => DECISION_LINE.test(line) && !OPEN_LINE.test(line))
    .filter((line) => subjects.some((subject) => line.includes(subject)))
    .map((line) => line.trim());

export type BriefInput = {
  kind: string;
  body: string;
  stepKey: string;
  pack: string;
  store?: Store;
};

export type Brief = {
  text: string;
  subjects: string[];
  missing: string[];
};

const section = (tag: string, lines: string[]): string =>
  `<${tag}>\n${lines.length > 0 ? lines.join("\n") : "none"}\n</${tag}>`;

const dependentSteps = (store: Store, stepKey: string): StoredStep[] => {
  const stage = stageOfKey(stepKey);
  if (!stage) return [];
  const same = store.stageSteps(stage);
  const plan = stage === "plan" ? [] : store.stageSteps("plan").filter((step) => /^plan(#\d+)?$/.test(step.key));
  const chosen = [...plan, ...same].filter(
    (step) => step.key !== stepKey && step.startedAt !== undefined && step.status !== "pending",
  );
  const own = same.find((step) => step.key === stepKey && step.status === "done");
  return own ? [...chosen, own] : chosen;
};

const describeResult = (step: StoredStep): string =>
  step.result
    ? `${step.key} (${step.status}):\n${JSON.stringify(step.result, null, 2)}`
    : `${step.key} (${step.status}): no stored result`;

export const buildBrief = (input: BriefInput): Brief => {
  const subjects = extractSubjects(input.body);
  const decisionsFile = path.join(input.pack, "03-decisions.md");
  const settled = fs.existsSync(decisionsFile)
    ? settledDecisionLines(fs.readFileSync(decisionsFile, "utf8"), subjects)
    : [];

  const store = input.store;
  const earlier = store
    ? store
        .decisions()
        .filter((entry) => entry.subjects.some((subject) => subjects.includes(subject)))
        .map(
          (entry) =>
            `#${entry.id} ${entry.step} ${entry.kind}\nQuestion: ${entry.question}\nDecision: ${entry.decision}: ${entry.text}`,
        )
    : [];

  const stage = stageOfKey(input.stepKey);
  const open = store
    ? store
        .openItems()
        .filter((item) => stage !== undefined && stageOfKey(item.phase) === stage)
        .map((item) => `${item.id} ${item.level} from ${item.fromAgent} at ${item.phase}: ${item.question}`)
    : [];

  const dependents = store ? dependentSteps(store, input.stepKey) : [];
  const missing = dependents
    .filter((step) => step.status === "done" && step.result === undefined)
    .map((step) => step.key);

  const text = [
    input.body,
    section("settled_decisions", settled),
    section("earlier_lead_decisions", earlier),
    section("open_items_of_this_stage", open),
    section("results_of_steps_this_step_depends_on", dependents.map(describeResult)),
  ].join("\n\n");

  return { text, subjects, missing };
};

export const missingResultText = (missing: string[]): string =>
  `The lead did not run: the stored result of ${missing.join(", ")} is missing, so the decision would rest on a guess. Record the result of each step, or answer this yourself.`;
