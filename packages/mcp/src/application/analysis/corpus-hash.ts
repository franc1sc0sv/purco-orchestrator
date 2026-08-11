import {
  corpusGlobToRegExp,
  literalPrefix,
} from "../../domain/analysis/glob.ts";
import { hashText, readTextFile } from "../../infrastructure/files.ts";
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type {
  CorpusFile,
  CorpusHashReport,
} from "test-forge-contracts/analysis";

export type AstCorpusHashOptions = {
  cwd: string;
  globs: readonly string[] | string;
  includeFiles?: boolean;
};

const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".yarn",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "playwright-report",
  "test-results",
]);

const DIGEST_SEPARATOR = "\u0000";

const posix = (value: string): string => value.split(sep).join("/");

const walk = (root: string, relativePath: string, found: Set<string>): void => {
  let entries;
  try {
    entries = readdirSync(join(root, relativePath), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const next = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      walk(root, next, found);
      continue;
    }
    if (entry.isFile()) found.add(next);
  }
};

const isFilePath = (candidate: string): boolean => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const isDirectoryPath = (candidate: string): boolean => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

const describeFile = (cwd: string, file: string): CorpusFile => {
  const content = readTextFile(resolve(cwd, file));
  return content === null
    ? { path: file, hash: "unreadable", lineCount: 0 }
    : {
        path: file,
        hash: hashText(content),
        lineCount: content.split(/\r?\n/).length,
      };
};

export const astCorpusHash = ({
  cwd,
  globs,
  includeFiles = false,
}: AstCorpusHashOptions): CorpusHashReport => {
  const patterns = (Array.isArray(globs) ? globs : [globs]).map((glob) =>
    glob.replace(/^\.\//, "")
  );
  const matchers = patterns.map(corpusGlobToRegExp);
  const candidates = new Set<string>();

  for (const glob of patterns) {
    const prefix = literalPrefix(glob);
    const base = resolve(cwd, prefix);
    if (isFilePath(base)) {
      candidates.add(posix(relative(cwd, base)));
      continue;
    }
    if (!isDirectoryPath(base)) continue;
    walk(cwd, prefix, candidates);
  }

  const files = [...candidates]
    .filter((file) => matchers.some((matcher) => matcher.test(file)))
    .sort()
    .map((file) => describeFile(cwd, file));

  const report: CorpusHashReport = {
    hash: hashText(files
      .map((file) => `${file.path}${DIGEST_SEPARATOR}${file.hash}\n`)
      .join("")),
    fileCount: files.length,
    totalLines: files.reduce((sum, file) => sum + file.lineCount, 0),
    globs: patterns,
  };
  return includeFiles ? { ...report, files } : report;
};
