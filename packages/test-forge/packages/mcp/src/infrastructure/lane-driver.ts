import { COMMAND_FD, REPLY_FD } from "./campaign-files.ts";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Duplex, Readable } from "node:stream";

const MAX_DIAGNOSTIC_BYTES = 4_000;

const READY_TIMEOUT_MS = 600_000;

const STOP_GRACE_MS = 10_000;

export type DriverRunCommand = {
  mutantId: number;
  invalidate: readonly string[];
  reportPath: string;
};

export type DriverRunResult = {
  mutantId: number;
  report: boolean;
  error: string | null;
  durationMs: number;
};

export type DriverOutcome =
  | { ok: true; result: DriverRunResult }
  | { ok: false; kind: "timeout" | "lost"; detail: string };

export type LaneDriver = {
  run: (command: DriverRunCommand, timeoutMs: number) => Promise<DriverOutcome>;
  stop: () => Promise<void>;
  diagnostics: () => string;
};

export type LaneDriverStart =
  { ok: true; driver: LaneDriver } | { ok: false; reason: string };

type Reply = { kind?: unknown } & Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const numberAt = (source: Record<string, unknown>, key: string): number => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const textOrNull = (
  source: Record<string, unknown>,
  key: string,
): string | null => {
  const value = source[key];
  return typeof value === "string" ? value : null;
};

const tail = (text: string): string =>
  text.length > MAX_DIAGNOSTIC_BYTES ? text.slice(-MAX_DIAGNOSTIC_BYTES) : text;

type Channels = { commands: Duplex; replies: Readable };

const channelsOf = (child: ChildProcess): Channels | null => {
  const commands = child.stdio[COMMAND_FD];
  const replies = child.stdio[REPLY_FD];
  if (!(commands instanceof Duplex)) return null;
  if (!(replies instanceof Readable)) return null;
  return { commands, replies };
};

type Waiter = {
  settle: (reply: Reply) => void;
  fail: (kind: "timeout" | "lost", detail: string) => void;
};

export const startLaneDriver = async ({
  driverPath,
  cwd,
  env,
}: {
  driverPath: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
}): Promise<LaneDriverStart> => {
  const child = spawn("node", [driverPath], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
  });

  const channels = channelsOf(child);
  if (channels === null) {
    child.kill("SIGKILL");
    return { ok: false, reason: "the driver channels could not be opened" };
  }

  let noise = "";
  const collect = (chunk: Buffer): void => {
    noise = tail(noise + chunk.toString("utf8"));
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const pending: Waiter[] = [];
  let buffer = "";
  let lost: string | null = null;
  let exited: Promise<void> | null = null;

  const deliver = (reply: Reply): void => {
    const waiter = pending.shift();
    if (waiter !== undefined) waiter.settle(reply);
  };

  channels.replies.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let cut = buffer.indexOf("\n");
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line !== "") {
        try {
          const parsed: unknown = JSON.parse(line);
          if (isRecord(parsed)) deliver(parsed);
        } catch {
          deliver({ kind: "fatal", error: `unreadable driver line: ${line}` });
        }
      }
      cut = buffer.indexOf("\n");
    }
  });

  const markLost = (detail: string): void => {
    lost = detail;
    while (pending.length > 0) {
      const waiter = pending.shift();
      if (waiter !== undefined) waiter.fail("lost", detail);
    }
  };

  child.on("error", (error) =>
    markLost(`the driver could not run: ${error.message}`),
  );
  child.on("close", (code, signal) =>
    markLost(
      `the driver exited (code ${String(code)}, signal ${String(signal)})`,
    ),
  );

  const nextReply = (timeoutMs: number): Promise<DriverOutcome> =>
    new Promise((settle) => {
      if (lost !== null) {
        settle({ ok: false, kind: "lost", detail: lost });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const index = pending.indexOf(waiter);
        if (index >= 0) pending.splice(index, 1);
        settle({
          ok: false,
          kind: "timeout",
          detail: `the driver did not answer within ${String(timeoutMs)}ms`,
        });
      }, timeoutMs);
      const waiter: Waiter = {
        settle: (reply) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (reply["kind"] === "result") {
            settle({
              ok: true,
              result: {
                mutantId: numberAt(reply, "mutantId"),
                report: reply["report"] === true,
                error: textOrNull(reply, "error"),
                durationMs: numberAt(reply, "durationMs"),
              },
            });
            return;
          }
          settle({
            ok: false,
            kind: "lost",
            detail:
              textOrNull(reply, "error") ??
              `the driver answered ${String(reply["kind"])}`,
          });
        },
        fail: (kind, detail) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          settle({ ok: false, kind, detail });
        },
      };
      pending.push(waiter);
    });

  const waitForExit = (): Promise<void> => {
    if (exited !== null) return exited;
    exited = new Promise<void>((settle) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        settle();
        return;
      }
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle();
      }, STOP_GRACE_MS);
      child.once("close", () => {
        clearTimeout(timer);
        settle();
      });
    });
    return exited;
  };

  const write = (payload: object): boolean => {
    if (lost !== null || channels.commands.destroyed) return false;
    return channels.commands.write(`${JSON.stringify(payload)}\n`);
  };

  const ready = new Promise<DriverOutcome>((settle) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      settle({
        ok: false,
        kind: "timeout",
        detail: `the driver was not ready within ${String(READY_TIMEOUT_MS)}ms`,
      });
    }, READY_TIMEOUT_MS);
    pending.push({
      settle: (reply) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (reply["kind"] === "ready") {
          settle({
            ok: true,
            result: { mutantId: 0, report: false, error: null, durationMs: 0 },
          });
          return;
        }
        settle({
          ok: false,
          kind: "lost",
          detail: textOrNull(reply, "error") ?? "the driver never became ready",
        });
      },
      fail: (kind, detail) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        settle({ ok: false, kind, detail });
      },
    });
  });

  const started = await ready;
  if (!started.ok) {
    child.kill("SIGKILL");
    await waitForExit();
    return {
      ok: false,
      reason: `${started.detail}${noise === "" ? "" : `: ${tail(noise)}`}`,
    };
  }

  return {
    ok: true,
    driver: {
      run: async (command, timeoutMs) => {
        if (lost !== null) {
          return { ok: false, kind: "lost", detail: lost };
        }
        const answer = nextReply(timeoutMs);
        if (!write({ kind: "run", ...command })) {
          return {
            ok: false,
            kind: "lost",
            detail: lost ?? "the driver channel was closed",
          };
        }
        return answer;
      },
      stop: async () => {
        write({ kind: "stop" });
        channels.commands.end();
        await waitForExit();
      },
      diagnostics: () => tail(noise),
    },
  };
};
