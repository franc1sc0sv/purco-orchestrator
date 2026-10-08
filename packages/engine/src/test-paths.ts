import path from "node:path";

const TEST_PATH = new RegExp(
  String.raw`[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|/)(tests?|__tests__|e2e|fixtures)/`,
  "i",
);

const WRITING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export const isTestPath = (file: string): boolean => TEST_PATH.test(file);

const SEGMENT_SPLIT = /[;&|\n(){}`]|\$\(/;
const SHELL_STRING = /\b(?:sh|bash|zsh|dash|ksh)\s+(?:-\S+\s+)*?-[a-zA-Z]*c\s+(["'])([\s\S]*?)\1|\beval\s+(["'])([\s\S]*?)\3/g;
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "time", "exec"]);
const WRAPPERS: Record<string, ReadonlySet<string>> = {
  env: new Set(["-u", "-C", "-S"]),
  command: new Set(),
  sudo: new Set(["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"]),
  xargs: new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"]),
  exec: new Set(["-a"]),
  nohup: new Set(),
  nice: new Set(["-n"]),
  builtin: new Set(),
  time: new Set(["-f", "-o"]),
  stdbuf: new Set(),
  timeout: new Set(),
};
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

const bare = (word: string): string => word.replace(/["'\\]/g, "");

const isGit = (word: string): boolean => /^(.*\/)?git$/.test(bare(word));

const segmentRunsGit = (segment: string): boolean => {
  const words = segment.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.some((word, index) => EXEC_FLAGS.has(word) && isGit(words[index + 1] ?? ""))) return true;
  let index = 0;
  while (index < words.length) {
    const word = bare(words[index] ?? "");
    const base = word.split("/").pop() ?? word;
    if (KEYWORDS.has(base) || ASSIGNMENT.test(word)) {
      index += 1;
      continue;
    }
    const wrapper = WRAPPERS[base];
    if (wrapper === undefined) return isGit(word);
    index += 1;
    while (index < words.length && (words[index] ?? "").startsWith("-")) {
      index += wrapper.has(words[index] ?? "") ? 2 : 1;
    }
  }
  return false;
};

const runsGit = (command: string): boolean => {
  if (command.split(SEGMENT_SPLIT).some(segmentRunsGit)) return true;
  return [...command.matchAll(SHELL_STRING)].some((match) => runsGit(match[2] ?? match[4] ?? ""));
};

export const testWriteRefusal = (
  tool: string,
  input: Record<string, unknown>,
  root: string,
  forgeDir?: string,
): string | undefined => {
  if (tool === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    return runsGit(command) ? "A test author never runs git." : undefined;
  }
  if (!WRITING_TOOLS.has(tool)) return undefined;
  const target = String(input.file_path ?? input.notebook_path ?? "");
  if (target.length === 0) return undefined;
  const resolved = path.resolve(root, target);
  if (forgeDir !== undefined && resolved.startsWith(path.resolve(forgeDir) + path.sep) && !target.includes("..")) {
    return undefined;
  }
  if (resolved.startsWith(path.resolve(root) + path.sep) && isTestPath(resolved)) return undefined;
  return `A test author writes test files only. "${target}" is production code: report the defect in your handoff instead.`;
};
