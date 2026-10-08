import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAF,
  answerEarly,
  answerItem,
  historyList,
  itemExists,
  isKnownTicket,
  markSeen,
  addTicketNote,
  ticketEventsUntil,
  ticketFailures,
  ticketToolTicks,
  ticketFileDiff,
  ticketFiles,
  ticketNotes,
  ticketStory,
  ticketRawLog,
  ticketDelta,
  ticketDetail,
  ticketList,
  ticketSnapshot,
  type StreamState,
} from "./dashboard-data.ts";
import { collectMailbox, collectRuns } from "./monitor.ts";
import { TOKEN_HEADER, checkRequest, createToken, injectToken, type GuardVerdict } from "./monitor-guard.ts";
import { MONITOR_PAGE } from "./monitor-page.ts";
import type { NewNote } from "./types.ts";
import { UsageMonitor } from "./usage.ts";

const DASHBOARD_DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dashboard",
  "dist",
);

const usageMonitor = new UsageMonitor();

const USAGE_REFRESH_MS = 10000;
const STREAM_INTERVAL_MS = 2000;
const DELTA_INTERVAL_MS = 250;
const FULL_SNAPSHOT_INTERVAL_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE_CHARS = 2000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const sendJson = (response: http.ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
};

const sendNotFound = (response: http.ServerResponse): void => {
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
};

const sendHtml = (response: http.ServerResponse, html: string): void => {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
};

const readBody = (request: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const parseAnswerText = (body: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("text" in parsed)) return undefined;
    const text = parsed.text;
    return typeof text === "string" && text.trim().length > 0 ? text.trim() : undefined;
  } catch {
    return undefined;
  }
};

const parseSeenIds = (body: string): number[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("ids" in parsed)) return undefined;
    const ids = parsed.ids;
    if (!Array.isArray(ids)) return undefined;
    return ids.every((id): id is number => Number.isInteger(id)) ? ids : undefined;
  } catch {
    return undefined;
  }
};

const parseNewNote = (body: string): NewNote | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { text, file, line, target_agent: target } = parsed as Record<string, unknown>;
    if (typeof text !== "string" || text.trim().length === 0) return undefined;
    if (file !== undefined && (typeof file !== "string" || file.length === 0)) return undefined;
    if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) return undefined;
    if (target !== undefined && (typeof target !== "string" || target.length === 0)) return undefined;
    return {
      text: text.trim().slice(0, MAX_NOTE_CHARS),
      via: "dashboard",
      ...(file !== undefined ? { file: file as string } : {}),
      ...(line !== undefined ? { line: line as number } : {}),
      ...(target !== undefined ? { targetAgent: target as string } : {}),
    };
  } catch {
    return undefined;
  }
};

const listSnapshot = (): unknown => ({ tickets: ticketList(), usage: usageMonitor.snapshot() });

const withoutClock = (key: string, value: unknown): unknown =>
  key === "generatedAt" ? undefined : value;

const sendEvent = (response: http.ServerResponse, event: string, data: unknown): void => {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

const streamList = (response: http.ServerResponse): NodeJS.Timeout => {
  let lastHash = "";
  const push = (): void => {
    const snapshot = listSnapshot();
    const hash = crypto
      .createHash("sha1")
      .update(JSON.stringify(snapshot, withoutClock))
      .digest("hex");
    if (hash === lastHash) return;
    lastHash = hash;
    sendEvent(response, "snapshot", snapshot);
  };
  push();
  return setInterval(push, STREAM_INTERVAL_MS);
};

const streamTicket = (response: http.ServerResponse, ticket: string): NodeJS.Timeout[] => {
  let state: StreamState | undefined;
  const sendSnapshot = (): void => {
    const snapshot = ticketSnapshot(ticket);
    if (!snapshot) return;
    state = snapshot.state;
    sendEvent(response, "snapshot", snapshot.detail);
  };
  const sendDelta = (): void => {
    if (!state) return sendSnapshot();
    const next = ticketDelta(ticket, state);
    if (!next) return;
    state = next.state;
    sendEvent(response, "delta", next.delta);
  };
  sendSnapshot();
  return [setInterval(sendDelta, DELTA_INTERVAL_MS), setInterval(sendSnapshot, FULL_SNAPSHOT_INTERVAL_MS)];
};

const openStream = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  ticket: string | null,
): void => {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const timers = ticket === null ? [streamList(response)] : streamTicket(response, ticket);
  const beat = setInterval(() => response.write(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);
  request.on("close", () => {
    for (const timer of [...timers, beat]) clearInterval(timer);
  });
};

const serveStatic = (url: URL, response: http.ServerResponse, token: string): boolean => {
  const index = path.join(DASHBOARD_DIST, "index.html");
  if (!fs.existsSync(index)) return false;
  const requested = path.normalize(path.join(DASHBOARD_DIST, decodeURIComponent(url.pathname)));
  const isFile =
    requested.startsWith(DASHBOARD_DIST + path.sep) &&
    fs.existsSync(requested) &&
    fs.statSync(requested).isFile();
  const file = isFile ? requested : index;
  if (file === index) {
    sendHtml(response, injectToken(fs.readFileSync(index, "utf8"), token));
    return true;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(response);
  return true;
};

const legacyState = (): unknown => {
  const runs = collectRuns();
  const mailbox = collectMailbox();
  return {
    generatedAt: new Date().toISOString(),
    mailbox,
    openQuestions: mailbox.filter((q) => q.answer === null || q.answer === undefined).length,
    activeOrchestrators: runs.filter((run) => run.active).length,
    totalRuns: runs.length,
    liveSubagents: runs
      .filter((run) => run.active)
      .reduce((sum, run) => sum + run.subagentCount, 0),
    totalCostUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
    openDecisions: runs.reduce(
      (sum, run) => sum + run.decisions.filter((d) => d.resolvedBy === undefined).length,
      0,
    ),
    runs,
  };
};

const REJECTIONS: Record<Exclude<GuardVerdict, "ok">, { status: number; message: string }> = {
  "bad-host": { status: 421, message: "misdirected request" },
  "bad-origin": { status: 403, message: "origin not allowed" },
  "bad-content-type": { status: 415, message: "json required" },
  "bad-token": { status: 403, message: "token required" },
};

const headerOf = (request: http.IncomingMessage, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(",") : value;
};

const route = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  guard: { port: number; token: string },
): Promise<void> => {
  const verdict = checkRequest(
    {
      method: request.method ?? "GET",
      host: headerOf(request, "host"),
      origin: headerOf(request, "origin"),
      contentType: headerOf(request, "content-type"),
      token: headerOf(request, TOKEN_HEADER),
    },
    guard.port,
    guard.token,
  );
  if (verdict !== "ok") {
    const rejection = REJECTIONS[verdict];
    return sendJson(response, rejection.status, { error: rejection.message });
  }
  const url = new URL(request.url ?? "/", "http://localhost");
  const method = request.method ?? "GET";
  const segments = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/api/state") return sendJson(response, 200, legacyState());
  if (url.pathname === "/api/tickets") return sendJson(response, 200, ticketList());
  if (url.pathname === "/api/usage") return sendJson(response, 200, usageMonitor.snapshot());
  if (url.pathname === "/api/history") return sendJson(response, 200, historyList());

  if (url.pathname === "/api/stream") {
    const ticket = url.searchParams.get("ticket");
    if (ticket !== null && !isKnownTicket(ticket)) return sendNotFound(response);
    return openStream(request, response, ticket);
  }

  if (segments[0] === "api" && segments[1] === "tickets" && segments[2] !== undefined) {
    const ticket = segments[2];
    if (!isKnownTicket(ticket)) return sendNotFound(response);
    if (segments.length === 3 && method === "GET") {
      const since = url.searchParams.get("since") ?? undefined;
      return sendJson(response, 200, ticketDetail(ticket, since) ?? null);
    }
    if (segments.length === 4 && segments[3] === "failures" && method === "GET") {
      return sendJson(response, 200, ticketFailures(ticket) ?? null);
    }
    if (segments.length === 4 && segments[3] === "ticks" && method === "GET") {
      return sendJson(response, 200, ticketToolTicks(ticket));
    }
    if (segments.length === 4 && segments[3] === "events" && method === "GET") {
      const until = url.searchParams.get("until") ?? "";
      if (Number.isNaN(Date.parse(until))) return sendJson(response, 400, { error: "until must be an ISO time" });
      return sendJson(response, 200, ticketEventsUntil(ticket, new Date(until).toISOString()));
    }
    if (segments.length === 4 && segments[3] === "story" && method === "GET") {
      return sendJson(response, 200, ticketStory(ticket) ?? null);
    }
    if (segments.length === 4 && segments[3] === "files" && method === "GET") {
      return sendJson(response, 200, ticketFiles(ticket) ?? { files: [] });
    }
    if (segments.length === 4 && segments[3] === "diff" && method === "GET") {
      const diff = ticketFileDiff(ticket, url.searchParams.get("path") ?? "");
      return diff ? sendJson(response, 200, diff) : sendNotFound(response);
    }
    if (segments.length === 4 && segments[3] === "notes" && method === "GET") {
      return sendJson(response, 200, ticketNotes(ticket));
    }
    if (segments.length === 4 && segments[3] === "notes" && method === "POST") {
      const note = parseNewNote(await readBody(request));
      if (note === undefined) return sendJson(response, 400, { error: "text is required" });
      return sendJson(response, 200, { id: addTicketNote(ticket, note) });
    }
    if (segments.length === 4 && segments[3] === "log" && method === "GET") {
      const agent = url.searchParams.get("agent") ?? "";
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return void response.end(ticketRawLog(ticket, agent));
    }
    const marksSeen =
      segments.length === 5 &&
      segments[3] === "alerts" &&
      segments[4] === "seen" &&
      method === "POST";
    if (marksSeen) {
      const ids = parseSeenIds(await readBody(request));
      if (ids === undefined) {
        return sendJson(response, 400, { error: "ids must be an array of integers" });
      }
      markSeen(ticket, ids);
      return sendJson(response, 200, { marked: ids.length });
    }
    const answersItem =
      segments.length === 6 &&
      segments[3] === "items" &&
      segments[5] === "answer" &&
      method === "POST";
    if (answersItem) {
      const id = segments[4] ?? "";
      if (!itemExists(ticket, id)) return sendNotFound(response);
      const text = parseAnswerText(await readBody(request));
      if (text === undefined) return sendJson(response, 400, { error: "text is required" });
      const result = answerItem(ticket, id, text);
      return sendJson(response, result === "answered" ? 200 : 409, { result });
    }
    const answersEarly =
      segments.length === 6 &&
      segments[3] === "grill" &&
      segments[5] === "early" &&
      method === "POST";
    if (answersEarly) {
      const qid = Number(segments[4]);
      if (!Number.isInteger(qid)) return sendNotFound(response);
      const text = parseAnswerText(await readBody(request));
      if (text === undefined) return sendJson(response, 400, { error: "text is required" });
      const result = answerEarly(ticket, qid, text);
      return sendJson(response, result === "answered" ? 200 : 409, { result });
    }
    return sendNotFound(response);
  }

  if (url.pathname === "/legacy") return sendHtml(response, MONITOR_PAGE);
  if (url.pathname.startsWith("/api/")) return sendNotFound(response);
  if (method === "GET" && serveStatic(url, response, guard.token)) return;
  if (url.pathname === "/") return sendHtml(response, MONITOR_PAGE);
  sendNotFound(response);
};

export const startMonitor = (port: number): void => {
  const guard = { port, token: createToken() };
  const server = http.createServer((request, response) => {
    route(request, response, guard).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "monitor error",
      });
    });
  });

  void usageMonitor.refresh();
  setInterval(() => void usageMonitor.refresh(), USAGE_REFRESH_MS);

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`monitor http://127.0.0.1:${port}\n`);
    process.stdout.write(`watching ${GAF} for orchestrator.sqlite stores\n`);
  });
};
