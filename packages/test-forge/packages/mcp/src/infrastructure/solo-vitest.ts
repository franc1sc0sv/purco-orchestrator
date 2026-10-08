import { readTextFile } from "./files.ts";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { Kill } from "test-forge-contracts/mutation";

const MAX_CAPTURE_BYTES = 200_000;

export type SoloVitestInput = {
  root: string;
  vitestConfigFile: string;
  testFiles: readonly string[];
  limitMs: number;
  lazyLimitMs?: (() => Promise<number | null>) | undefined;
  reportFile: string;
  bail: boolean;
  testNamePattern: string | null;
  laneIndex: number;
};

export type SoloVitestResult = {
  timedOut: boolean;
  unmeasured: boolean;
  exitCode: number | null;
  durationMs: number;
  passed: number;
  failures: Kill[];
  suiteErrors: Kill[];
  suiteMessage: string;
  outputTail: string;
};

type JsonReport = {
  testResults: {
    name: string;
    status: string;
    message: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

const parseReport = (text: string | null): JsonReport | null => {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !Array.isArray(parsed["testResults"])) return null;
    const testResults = parsed["testResults"].flatMap((entry: unknown) => {
      if (!isRecord(entry)) return [];
      const assertions = Array.isArray(entry["assertionResults"])
        ? entry["assertionResults"].flatMap((assertion: unknown) =>
            isRecord(assertion)
              ? [
                  {
                    fullName: stringOf(assertion["fullName"]),
                    status: stringOf(assertion["status"]),
                  },
                ]
              : [],
          )
        : [];
      return [
        {
          name: stringOf(entry["name"]),
          status: stringOf(entry["status"]),
          message: stringOf(entry["message"]),
          assertionResults: assertions,
        },
      ];
    });
    return { testResults };
  } catch {
    return null;
  }
};

const relativeTo = (root: string, path: string): string =>
  isAbsolute(path) ? relative(root, path) : path;

const killGroup = (pid: number | undefined): void => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    return;
  }
};

export const runVitestSolo = (
  input: SoloVitestInput,
): Promise<SoloVitestResult> =>
  new Promise((settle) => {
    const { root, limitMs, reportFile } = input;
    mkdirSync(dirname(reportFile), { recursive: true });
    rmSync(reportFile, { force: true });
    const startedAt = Date.now();
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--config",
        input.vitestConfigFile,
        "--reporter=json",
        `--outputFile=${reportFile}`,
        "--no-file-parallelism",
        ...(input.bail ? ["--bail=1"] : []),
        ...(input.testNamePattern === null ? [] : ["-t", input.testNamePattern]),
        ...input.testFiles,
      ],
      {
        cwd: root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          STRYKER_MUTATOR_WORKER: String(input.laneIndex),
        },
      },
    );
    let captured = "";
    const collect = (chunk: Buffer): void => {
      if (captured.length < MAX_CAPTURE_BYTES) captured += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    let unmeasured = false;
    let finished = false;
    const expire = (): void => {
      timedOut = true;
      killGroup(child.pid);
    };
    let timer: NodeJS.Timeout = setTimeout(() => {
      const { lazyLimitMs } = input;
      if (lazyLimitMs === undefined) {
        expire();
        return;
      }
      void lazyLimitMs().then((resolved) => {
        if (finished) return;
        if (resolved === null) {
          unmeasured = true;
          killGroup(child.pid);
          return;
        }
        const remainingMs = resolved - (Date.now() - startedAt);
        if (remainingMs <= 0) expire();
        else timer = setTimeout(expire, remainingMs);
      });
    }, limitMs);
    const finish = (exitCode: number | null): void => {
      finished = true;
      clearTimeout(timer);
      killGroup(child.pid);
      const report = parseReport(readTextFile(reportFile));
      const results = report?.testResults ?? [];
      const failures = results.flatMap((suite) =>
        suite.assertionResults
          .filter((assertion) => assertion.status === "failed")
          .map((assertion) => ({
            file: relativeTo(root, suite.name),
            name: assertion.fullName,
          })),
      );
      const failedSuites = results.filter(
        (suite) =>
          suite.status === "failed" &&
          !suite.assertionResults.some((assertion) => assertion.status === "failed"),
      );
      settle({
        timedOut,
        unmeasured,
        exitCode,
        durationMs: Date.now() - startedAt,
        passed: results.reduce(
          (count, suite) =>
            count +
            suite.assertionResults.filter((assertion) => assertion.status === "passed")
              .length,
          0,
        ),
        failures,
        suiteErrors: failedSuites.map((suite) => ({
          file: relativeTo(root, suite.name),
          name: "the test file failed to run",
        })),
        suiteMessage: failedSuites.map((suite) => suite.message).join("\n") + captured,
        outputTail: captured.slice(-3000),
      });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
