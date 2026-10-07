import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAF,
  answerItem,
  historyList,
  itemExists,
  isKnownTicket,
  markSeen,
  ticketDetail,
  ticketList,
} from "./dashboard-data.ts";
import { collectMailbox, collectRuns } from "./monitor.ts";
import { TOKEN_HEADER, checkRequest, createToken, injectToken, type GuardVerdict } from "./monitor-guard.ts";
import { MONITOR_PAGE } from "./monitor-page.ts";
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
const HEARTBEAT_INTERVAL_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;

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

const snapshotFor = (ticket: string | null): unknown =>
  ticket === null ? { tickets: ticketList(), usage: usageMonitor.snapshot() } : (ticketDetail(ticket) ?? null);

const withoutClock = (key: string, value: unknown): unknown =>
  key === "generatedAt" ? undefined : value;

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
  let lastHash = "";
  const push = (): void => {
    const snapshot = snapshotFor(ticket);
    const hash = crypto
      .createHash("sha1")
      .update(JSON.stringify(snapshot, withoutClock))
      .digest("hex");
    if (hash === lastHash) return;
    lastHash = hash;
    response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };
  push();
  const data = setInterval(push, STREAM_INTERVAL_MS);
  const beat = setInterval(() => response.write(": heartbeat\n\n"), HEARTBEAT_INTERVAL_MS);
  request.on("close", () => {
    clearInterval(data);
    clearInterval(beat);
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
