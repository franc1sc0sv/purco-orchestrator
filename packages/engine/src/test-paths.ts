import os from "node:os";
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

const REDIRECT = /(?:^|[^<>&0-9])[0-9]?>{1,2}\s*(["']?)([^\s;&|<>()"']+)\1/g;
const FILE_WRITERS = new Set(["tee", "cp", "mv", "rm", "touch", "truncate", "install", "ln", "rsync"]);
const LAST_ARGUMENT_WRITERS = new Set(["cp", "mv", "install", "ln", "rsync"]);
const IN_PLACE_EDITORS = new Set(["sed", "gsed", "perl"]);
const TEMPORARY_ROOTS = [os.tmpdir(), "/tmp", "/private/tmp"].map((root) => path.resolve(root) + path.sep);

const writeTargets = (command: string): string[] => {
  const targets = [...command.matchAll(REDIRECT)].map((match) => match[2] ?? "");
  for (const segment of command.split(SEGMENT_SPLIT)) {
    const words = segment.trim().split(/\s+/).filter((word) => word.length > 0).map(bare);
    const base = (words[0] ?? "").split("/").pop() ?? "";
    const args = words.slice(1).filter((word) => word.length > 0 && !word.startsWith("-"));
    if (FILE_WRITERS.has(base)) targets.push(...(LAST_ARGUMENT_WRITERS.has(base) ? args.slice(-1) : args));
    if (IN_PLACE_EDITORS.has(base) && words.some((word) => /^-[a-zA-Z]*i/.test(word) || word === "--in-place")) {
      targets.push(...args.slice(1));
    }
    const output = words.find((word) => word.startsWith("of="));
    if (output) targets.push(output.slice(3));
  }
  return targets.filter((target) => target.length > 0 && !target.startsWith("/dev/"));
};

const TARGETS_FILE = /^targets-[\w.-]+\.json$/;

const isTargetsFile = (resolved: string, forgeDir: string): boolean =>
  resolved.startsWith(path.resolve(forgeDir) + path.sep) && TARGETS_FILE.test(path.basename(resolved));

const HOLES_FILE = /^holes-[\w.-]+\.json$/;

export const forgeWriteRefusal = (tool: string, input: Record<string, unknown>, forgeDir: string): string | undefined => {
  if (!WRITING_TOOLS.has(tool)) return undefined;
  const target = String(input.file_path ?? input.notebook_path ?? "");
  const resolved = path.resolve(forgeDir, target);
  const allowed =
    !target.includes("..") &&
    resolved.startsWith(path.resolve(forgeDir) + path.sep) &&
    HOLES_FILE.test(path.basename(resolved));
  return allowed ? undefined : `This role writes only its holes-*.json file in ${forgeDir}. "${target}" is refused.`;
};

const mayWrite = (target: string, root: string, forgeDir: string | undefined): boolean => {
  const resolved = path.resolve(root, target);
  if (TEMPORARY_ROOTS.some((prefix) => resolved.startsWith(prefix))) return true;
  if (forgeDir !== undefined && isTargetsFile(resolved, forgeDir) && !target.includes("..")) return true;
  return resolved.startsWith(path.resolve(root) + path.sep) && isTestPath(resolved);
};

export const testWriteRefusal = (
  tool: string,
  input: Record<string, unknown>,
  root: string,
  forgeDir?: string,
): string | undefined => {
  if (tool === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (runsGit(command)) return "A test author never runs git.";
    const refused = writeTargets(command).find((target) => !mayWrite(target, root, forgeDir));
    return refused === undefined
      ? undefined
      : `A test author writes test files only. The command writes "${refused}": write test files with Write or Edit.`;
  }
  if (!WRITING_TOOLS.has(tool)) return undefined;
  const target = String(input.file_path ?? input.notebook_path ?? "");
  if (target.length === 0) return undefined;
  const resolved = path.resolve(root, target);
  if (forgeDir !== undefined && isTargetsFile(resolved, forgeDir) && !target.includes("..")) return undefined;
  if (resolved.startsWith(path.resolve(root) + path.sep) && isTestPath(resolved)) return undefined;
  return `A test author writes test files only. "${target}" is production code: report the defect in your handoff instead.`;
};
