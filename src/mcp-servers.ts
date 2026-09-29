import fs from "node:fs";
import path from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export const PLAYWRIGHT_SERVER: McpServerConfig = {
  type: "stdio",
  command: "npx",
  args: ["@playwright/mcp@latest"],
  alwaysLoad: true,
  timeout: 120_000,
};

export const PLAYWRIGHT_TOOLS = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_select_option",
  "browser_hover",
  "browser_press_key",
  "browser_take_screenshot",
  "browser_console_messages",
  "browser_network_requests",
  "browser_wait_for",
  "browser_evaluate",
  "browser_resize",
  "browser_tabs",
  "browser_close",
].map((name) => `mcp__playwright__${name}`);


type RawEntry = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export const expandPlaceholders = (
  value: string,
  lookup: (name: string) => string | undefined,
): string =>
  value.replace(PLACEHOLDER, (_match, name: string, fallback?: string) => {
    const resolved = lookup(name);
    if (resolved !== undefined && resolved.length > 0) return resolved;
    return fallback ?? "";
  });

export const expandedNames = (value: string): string[] => {
  const names: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER)) names.push(match[1]);
  return names;
};
