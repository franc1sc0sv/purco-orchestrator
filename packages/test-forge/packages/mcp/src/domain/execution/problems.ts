import {
  clamp,
  MAX_MESSAGE_CHARS,
  MAX_PROBLEMS,
  stripAnsi,
} from "./command.ts";
import type {
  Problem,
  ProblemSeverity,
  ProblemSummary,
} from "test-forge-contracts/execution";

const TYPECHECK_WITH_LOCATION =
  /^(.+?)[(:](\d+)[,:](\d+)\)?\s*[-:]?\s*(error|warning)\s+(TS\d+)\s*:\s*(.*)$/;

const TYPECHECK_WITHOUT_LOCATION = /^\s*(error|warning)\s+(TS\d+)\s*:\s*(.*)$/;

const STYLISH_HEADER = /^(?:[./~]|[A-Za-z]:)?[^\s:]*\.[A-Za-z]{1,6}$/;

const STYLISH_PROBLEM =
  /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}([\w@/\-.[\]]+))?\s*$/;

const severityOf = (value: string | undefined): ProblemSeverity =>
  value === "warning" ? "warning" : "error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseTypecheckProblems = (text: string): Problem[] => {
  const problems: Problem[] = [];
  for (const rawLine of stripAnsi(text).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const located = TYPECHECK_WITH_LOCATION.exec(line);
    if (located !== null) {
      problems.push({
        file: (located[1] ?? "").trim(),
        line: Number(located[2]),
        column: Number(located[3]),
        severity: severityOf(located[4]),
        code: located[5] ?? null,
        message: clamp(located[6] ?? "", MAX_MESSAGE_CHARS),
      });
      continue;
    }
    const bare = TYPECHECK_WITHOUT_LOCATION.exec(line);
    if (bare !== null) {
      problems.push({
        file: null,
        line: null,
        column: null,
        severity: severityOf(bare[1]),
        code: bare[2] ?? null,
        message: clamp(bare[3] ?? "", MAX_MESSAGE_CHARS),
      });
    }
  }
  return problems;
};

export const parseEslintJson = (text: string): Problem[] | null => {
  const trimmed = stripAnsi(text).trim();
  const start = trimmed.indexOf("[");
  if (start === -1) return null;
  let report: unknown;
  try {
    report = JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
  if (!Array.isArray(report)) return null;

  const problems: Problem[] = [];
  for (const entry of report) {
    if (!isRecord(entry)) continue;
    const filePath = entry["filePath"];
    const messages = entry["messages"];
    if (!Array.isArray(messages)) continue;
    for (const message of messages) {
      if (!isRecord(message)) continue;
      const detail = message["message"];
      const line = message["line"];
      const column = message["column"];
      const ruleId = message["ruleId"];
      problems.push({
        file: typeof filePath === "string" ? filePath : null,
        line: typeof line === "number" ? line : null,
        column: typeof column === "number" ? column : null,
        severity: message["severity"] === 2 ? "error" : "warning",
        code: typeof ruleId === "string" ? ruleId : null,
        message: clamp(
          typeof detail === "string" ? detail : "",
          MAX_MESSAGE_CHARS
        ),
      });
    }
  }
  return problems;
};

export const parseStylish = (text: string): Problem[] => {
  const problems: Problem[] = [];
  let currentFile: string | null = null;
  for (const rawLine of stripAnsi(text).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (!/^\s/.test(line) && STYLISH_HEADER.test(line.trim())) {
      currentFile = line.trim();
      continue;
    }
    const match = STYLISH_PROBLEM.exec(line);
    if (match === null) continue;
    problems.push({
      file: currentFile,
      line: Number(match[1]),
      column: Number(match[2]),
      severity: severityOf(match[3]),
      code: match[5] ?? null,
      message: clamp(match[4] ?? "", MAX_MESSAGE_CHARS),
    });
  }
  return problems;
};

export const summarise = (problems: readonly Problem[]): ProblemSummary => ({
  errorCount: problems.filter((problem) => problem.severity === "error").length,
  warningCount: problems.filter((problem) => problem.severity === "warning")
    .length,
  problems: problems.slice(0, MAX_PROBLEMS),
  truncated: problems.length > MAX_PROBLEMS,
  totalProblems: problems.length,
});
