import { clamp, MAX_MESSAGE_CHARS, stripAnsi } from "./command.ts";
import type {
  FailureRecord,
  ParsedRun,
  RunnerFamily,
  TestRecord,
} from "test-forge-contracts/execution";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const recordAt = (
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null => {
  const value = source[key];
  return isRecord(value) ? value : null;
};

const listAt = (
  source: Record<string, unknown>,
  key: string
): Record<string, unknown>[] => {
  const value = source[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const stringAt = (
  source: Record<string, unknown>,
  ...keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string") return value;
  }
  return null;
};

const numberAt = (
  source: Record<string, unknown>,
  ...keys: readonly string[]
): number | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number") return value;
  }
  return null;
};

const stringListAt = (
  source: Record<string, unknown>,
  key: string
): string[] => {
  const value = source[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

const countOf = (tests: readonly TestRecord[], status: string): number =>
  tests.filter((test) => test.status === status).length;

export const extractJsonBlock = (text: string): string | null => {
  const source = stripAnsi(text);
  const start = source.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) inString = false;
      continue;
    }
    if (character === '"' || character === "'") {
      inString = true;
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
};

const parseJestShaped = (report: Record<string, unknown>): ParsedRun => {
  const tests: TestRecord[] = [];
  const failures: FailureRecord[] = [];

  for (const suite of listAt(report, "testResults")) {
    const file = stringAt(suite, "name", "testFilePath", "file") ?? "";
    const assertions = listAt(suite, "assertionResults");
    for (const assertion of assertions) {
      const name =
        stringAt(assertion, "fullName") ??
        [
          ...stringListAt(assertion, "ancestorTitles"),
          stringAt(assertion, "title") ?? "",
        ]
          .filter((part) => part.length > 0)
          .join(" > ");
      const rawStatus = stringAt(assertion, "status") ?? "";
      const status = rawStatus === "pending" ? "skipped" : rawStatus;
      tests.push({ file, testName: name, status });
      if (status === "failed") {
        failures.push({
          file,
          testName: name,
          message: clamp(
            stringListAt(assertion, "failureMessages").join("\n"),
            MAX_MESSAGE_CHARS
          ),
        });
      }
    }
    if (assertions.length === 0 && stringAt(suite, "status") === "failed") {
      failures.push({
        file,
        testName: "<suite did not run>",
        message: clamp(
          stringAt(suite, "message", "failureMessage") ??
            "suite failed to load",
          MAX_MESSAGE_CHARS
        ),
      });
    }
  }

  const startTime = numberAt(report, "startTime");
  const endTime = numberAt(report, "endTime");

  return {
    passed: numberAt(report, "numPassedTests") ?? countOf(tests, "passed"),
    failed: numberAt(report, "numFailedTests") ?? countOf(tests, "failed"),
    skipped:
      numberAt(report, "numPendingTests", "numTodoTests") ??
      countOf(tests, "skipped"),
    failures,
    tests,
    durationMs:
      startTime !== null && endTime !== null
        ? Math.max(0, endTime - startTime)
        : null,
  };
};

const parsePlaywright = (report: Record<string, unknown>): ParsedRun => {
  const tests: TestRecord[] = [];
  const failures: FailureRecord[] = [];

  const walk = (
    suites: readonly Record<string, unknown>[],
    ancestors: readonly string[]
  ): void => {
    for (const suite of suites) {
      const suiteTitle = stringAt(suite, "title");
      const trail =
        suiteTitle !== null && suiteTitle.length > 0
          ? [...ancestors, suiteTitle]
          : ancestors;
      for (const spec of listAt(suite, "specs")) {
        const file = stringAt(spec, "file") ?? stringAt(suite, "file") ?? "";
        const name = [...trail, stringAt(spec, "title") ?? ""]
          .filter((part) => part.length > 0)
          .join(" > ");
        const attempts = listAt(spec, "tests").flatMap((entry) =>
          listAt(entry, "results")
        );
        const last = attempts.at(-1);
        const status =
          spec["ok"] === true
            ? "passed"
            : last !== undefined && stringAt(last, "status") === "skipped"
            ? "skipped"
            : "failed";
        tests.push({ file, testName: name, status });
        if (status === "failed") {
          const errors = attempts.flatMap((result) => {
            const error = recordAt(result, "error");
            return error === null ? [] : [stringAt(error, "message") ?? ""];
          });
          failures.push({
            file,
            testName: name,
            message: clamp(errors.join("\n"), MAX_MESSAGE_CHARS),
          });
        }
      }
      walk(listAt(suite, "suites"), trail);
    }
  };

  walk(listAt(report, "suites"), []);
  const stats = recordAt(report, "stats") ?? {};

  return {
    passed: numberAt(stats, "expected") ?? countOf(tests, "passed"),
    failed: numberAt(stats, "unexpected") ?? countOf(tests, "failed"),
    skipped: numberAt(stats, "skipped") ?? countOf(tests, "skipped"),
    failures,
    tests,
    durationMs: numberAt(stats, "duration"),
  };
};

const parseMocha = (report: Record<string, unknown>): ParsedRun => {
  const tests: TestRecord[] = [];
  const failures: FailureRecord[] = [];

  const named = (entry: Record<string, unknown>): string =>
    stringAt(entry, "fullTitle", "title") ?? "";

  for (const entry of listAt(report, "passes")) {
    tests.push({
      file: stringAt(entry, "file") ?? "",
      testName: named(entry),
      status: "passed",
    });
  }
  for (const entry of listAt(report, "pending")) {
    tests.push({
      file: stringAt(entry, "file") ?? "",
      testName: named(entry),
      status: "skipped",
    });
  }
  for (const entry of listAt(report, "failures")) {
    const file = stringAt(entry, "file") ?? "";
    const name = named(entry);
    const error = recordAt(entry, "err");
    tests.push({ file, testName: name, status: "failed" });
    failures.push({
      file,
      testName: name,
      message: clamp(
        error === null ? "" : stringAt(error, "stack", "message") ?? "",
        MAX_MESSAGE_CHARS
      ),
    });
  }

  const stats = recordAt(report, "stats") ?? {};

  return {
    passed: numberAt(stats, "passes") ?? countOf(tests, "passed"),
    failed: numberAt(stats, "failures") ?? countOf(tests, "failed"),
    skipped: numberAt(stats, "pending") ?? countOf(tests, "skipped"),
    failures,
    tests,
    durationMs: numberAt(stats, "duration"),
  };
};

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

const decodeXml = (value: string): string =>
  value.replace(
    /&(?:lt|gt|quot|apos|amp|#\d+);/g,
    (entity) =>
      XML_ENTITIES[entity] ?? String.fromCharCode(Number(entity.slice(2, -1)))
  );

const readAttributes = (text: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:-]+)="([^"]*)"/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) attributes[name] = decodeXml(match[2] ?? "");
    match = pattern.exec(text);
  }
  return attributes;
};

const JUNIT_TAG_PATTERN =
  /<(\/?)(testsuites|testsuite|testcase|failure|error|skipped)\b([^>]*?)(\/?)>/g;

export const parseJunit = (text: string): ParsedRun => {
  const source = stripAnsi(text);
  if (!/<testsuites?\b/.test(source)) {
    throw new Error("report is not a JUnit document");
  }

  const tests: TestRecord[] = [];
  const failures: FailureRecord[] = [];
  const suiteStack: string[] = [];
  let current: TestRecord | null = null;
  let durationMs: number | null = null;

  JUNIT_TAG_PATTERN.lastIndex = 0;
  let match = JUNIT_TAG_PATTERN.exec(source);
  while (match !== null) {
    const closing = match[1] === "/";
    const tag = match[2] ?? "";
    const selfClosing = match[4] === "/";
    const attributes = readAttributes(match[3] ?? "");

    if (tag === "testsuites" && !closing) {
      const time = attributes["time"];
      if (time !== undefined) durationMs = Number(time) * 1000;
    } else if (tag === "testsuite") {
      if (closing) suiteStack.pop();
      else if (!selfClosing) suiteStack.push(attributes["name"] ?? "");
    } else if (tag === "testcase") {
      if (closing) {
        current = null;
      } else {
        const entry: TestRecord = {
          file: attributes["file"] ?? "",
          testName: [...suiteStack, attributes["name"] ?? ""]
            .filter((part) => part.length > 0)
            .join(" > "),
          status: "passed",
        };
        tests.push(entry);
        current = selfClosing ? null : entry;
      }
    } else if (!closing && current !== null) {
      if (tag === "skipped") {
        current.status = "skipped";
      } else {
        current.status = "failed";
        const bodyStart = match.index + match[0].length;
        const bodyEnd = source.indexOf(`</${tag}>`, bodyStart);
        const body =
          bodyEnd === -1 ? "" : decodeXml(source.slice(bodyStart, bodyEnd));
        failures.push({
          file: current.file,
          testName: current.testName,
          message: clamp(
            [attributes["message"], body]
              .filter(
                (part): part is string => part !== undefined && part.length > 0
              )
              .join("\n"),
            MAX_MESSAGE_CHARS
          ),
        });
      }
    }

    match = JUNIT_TAG_PATTERN.exec(source);
  }

  return {
    passed: countOf(tests, "passed"),
    failed: countOf(tests, "failed"),
    skipped: countOf(tests, "skipped"),
    failures,
    tests,
    durationMs,
  };
};

export const parseReport = (family: RunnerFamily, text: string): ParsedRun => {
  if (family === "node-test") return parseJunit(text);
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) return parseJunit(text);
  const block =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? text
      : extractJsonBlock(text);
  if (block === null) throw new Error("report contained no JSON object");
  const parsed: unknown = JSON.parse(block);
  if (!isRecord(parsed)) throw new Error("report is not a JSON object");

  if (family === "playwright" || Array.isArray(parsed["suites"])) {
    if (!Array.isArray(parsed["suites"]) && !isRecord(parsed["stats"])) {
      throw new Error("report is not a Playwright document");
    }
    return parsePlaywright(parsed);
  }
  if (
    family === "mocha" ||
    (isRecord(parsed["stats"]) && Array.isArray(parsed["failures"]))
  ) {
    if (!isRecord(parsed["stats"])) {
      throw new Error("report is not a Mocha document");
    }
    return parseMocha(parsed);
  }
  if (
    !Array.isArray(parsed["testResults"]) &&
    parsed["numTotalTests"] === undefined
  ) {
    throw new Error("report is not a Jest or Vitest document");
  }
  return parseJestShaped(parsed);
};
