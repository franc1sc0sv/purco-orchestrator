import crypto from "node:crypto";

export const TOKEN_HEADER = "x-purco-token";

export type GuardVerdict = "ok" | "bad-host" | "bad-origin" | "bad-content-type" | "bad-token";

export type GuardInput = {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  token: string | undefined;
};

export const createToken = (): string => crypto.randomBytes(32).toString("hex");

export const isAllowedHost = (host: string | undefined, port: number): boolean =>
  host === `127.0.0.1:${port}` || host === `localhost:${port}`;

export const isAllowedOrigin = (origin: string | undefined, port: number): boolean =>
  origin === undefined ||
  origin === `http://127.0.0.1:${port}` ||
  origin === `http://localhost:${port}`;

export const isJsonContent = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.split(";")[0]?.trim().toLowerCase() === "application/json";

export const isValidToken = (provided: string | undefined, expected: string): boolean => {
  if (provided === undefined) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export const checkRequest = (input: GuardInput, port: number, expectedToken: string): GuardVerdict => {
  if (!isAllowedHost(input.host, port)) return "bad-host";
  if (input.method === "GET") return "ok";
  if (!isJsonContent(input.contentType)) return "bad-content-type";
  if (!isAllowedOrigin(input.origin, port)) return "bad-origin";
  if (!isValidToken(input.token, expectedToken)) return "bad-token";
  return "ok";
};

export const injectToken = (html: string, token: string): string =>
  html.replace("</head>", `<meta name="purco-token" content="${token}" /></head>`);
