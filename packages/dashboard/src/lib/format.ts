export const formatCost = (usd: number): string =>
  usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;

export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
};

export const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

export const shortModel = (model: string): string => {
  const match = /(opus|sonnet|haiku|fable)/i.exec(model);
  return match?.[1]?.toLowerCase() ?? model.slice(0, 12);
};

export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const formatCountdown = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};

export const shortFile = (file: string): string => file.split("/").pop() ?? file;

export const formatResetIn = (ms: number): string => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

export const formatResetShort = (ms: number): string => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};

export const formatResetAt = (epochMs: number): string =>
  new Date(epochMs).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

export const formatResetAtShort = (epochMs: number): string =>
  new Date(epochMs).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const formatAgo = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "just now";
  return `${minutes} min ago`;
};
