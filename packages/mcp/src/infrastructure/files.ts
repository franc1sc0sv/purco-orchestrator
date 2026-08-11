import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "public",
  "static",
  "playwright-report",
  "test-results",
  "generated",
]);

export const MAX_FILE_BYTES = 512 * 1024;

const GLOB_TOKEN = /\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g;

const toPosix = (path: string): string => path.split(sep).join("/");

export const isSourceFile = (name: string): boolean =>
  SOURCE_EXTENSIONS.includes(extname(name));

const walk = (dir: string, root: string, found: string[]): string[] => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walk(full, root, found);
      continue;
    }
    if (!entry.isFile() || !isSourceFile(entry.name)) continue;
    found.push(toPosix(relative(root, full)));
  }
  return found;
};

export const listSourceFiles = (root: string): string[] => walk(root, root, []);

export const readTextFile = (absolutePath: string): string | null => {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
};

export const readSourceFile = (
  root: string,
  relativePath: string
): string | null => {
  const text = readTextFile(join(root, relativePath));
  if (text === null) return null;
  return text.length > MAX_FILE_BYTES ? null : text;
};

export const absolutePath = (cwd: string, filePath: string): string =>
  isAbsolute(filePath) ? filePath : resolve(cwd, filePath);

export const readableFile = (cwd: string, filePath: string): string | null => {
  const absolute = absolutePath(cwd, filePath);
  return existsSync(absolute) && statSync(absolute).isFile() ? absolute : null;
};

export const projectRelative = (cwd: string, filePath: string): string => {
  const absolute = absolutePath(cwd, filePath);
  const fromRoot = relative(cwd, absolute).replace(/\\/g, "/");
  return fromRoot && !fromRoot.startsWith("..") ? fromRoot : absolute;
};

export const pathCandidates = (cwd: string, filePath: string): string[] => {
  const normalised = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const candidates = new Set([normalised, basename(normalised)]);
  const fromRoot = relative(cwd, absolutePath(cwd, filePath)).replace(
    /\\/g,
    "/"
  );
  if (fromRoot && !fromRoot.startsWith("..")) candidates.add(fromRoot);
  return [...candidates];
};

export const globToRegExp = (glob: string): RegExp => {
  const body = glob.replace(GLOB_TOKEN, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    if (token === "?") return "[^/]";
    return `\\${token}`;
  });
  return new RegExp(`^${body}$`);
};

export const matchesAnyGlob = (
  patterns: readonly string[],
  candidates: readonly string[]
): boolean =>
  patterns.some((pattern) => {
    const regex = globToRegExp(pattern);
    return candidates.some((candidate) => regex.test(candidate));
  });

export const hashText = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

export const hashFile = (absoluteFilePath: string): string | null => {
  const text = readTextFile(absoluteFilePath);
  return text === null ? null : hashText(text);
};
