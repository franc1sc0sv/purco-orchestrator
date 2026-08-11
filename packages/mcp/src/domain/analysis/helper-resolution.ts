import type { SourceFacts } from "./source-facts.ts";
import { matchBracket, scanSource } from "./source-facts.ts";

export type ModuleResolution =
  | { kind: "file"; path: string; source: string }
  | { kind: "package" }
  | { kind: "missing" };

export type ModuleResolver = (
  specifier: string,
  fromPath: string
) => ModuleResolution;

export type EvaluationContext = {
  filePath: string;
  resolveModule: ModuleResolver;
};

export type HelperResolution =
  | { kind: "body"; path: string; facts: SourceFacts }
  | { kind: "unresolved"; reason: string };

const MAX_HOPS = 8;

const OPENERS = "([{";

const CLOSERS = ")]}";

const CONTINUING_CHARACTERS = "=+-*/%&|,.?:<>!~^";

const EXPORT_BEFORE = /\bexport\s+(?:default\s+)?(?:async\s+)?$/;

const NAMED_REEXPORT = /\bexport\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

const STAR_REEXPORT = /\bexport\s*\*\s*from\s*['"]([^'"]+)['"]/g;

const unresolved = (reason: string): HelperResolution => ({
  kind: "unresolved",
  reason,
});

const lastSignificantBefore = (masked: string, index: number): string => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = masked.charAt(cursor);
    if (!/\s/.test(character)) return character;
  }
  return "";
};

const definitionEnd = (masked: string, start: number): number => {
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const character = masked.charAt(index);
    if (character === "{" && depth === 0) {
      const close = matchBracket(masked, index);
      return close === -1 ? masked.length : close + 1;
    }
    if (OPENERS.includes(character)) {
      depth += 1;
      continue;
    }
    if (CLOSERS.includes(character)) {
      depth -= 1;
      continue;
    }
    if (depth > 0) continue;
    if (character === ";") return index + 1;
    if (character === "\n") {
      const previous = lastSignificantBefore(masked, index);
      if (previous !== "" && !CONTINUING_CHARACTERS.includes(previous)) {
        return index;
      }
    }
  }
  return masked.length;
};

const isolateBody = (source: string, start: number, end: number): string => {
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  return (
    blank(source.slice(0, start)) +
    source.slice(start, end) +
    blank(source.slice(end))
  );
};

const localDefinition = (facts: SourceFacts, name: string): number | null => {
  const importIndexes = new Set(facts.imports.map((entry) => entry.index));
  const matches = facts.declarations.filter(
    (entry) => entry.name === name && !importIndexes.has(entry.index)
  );
  const exported = matches.find((entry) =>
    EXPORT_BEFORE.test(
      facts.source.slice(Math.max(0, entry.index - 32), entry.index)
    )
  );
  return (exported ?? matches[0])?.index ?? null;
};

const namedReexport = (
  source: string,
  name: string
): { local: string; module: string } | null => {
  NAMED_REEXPORT.lastIndex = 0;
  let match = NAMED_REEXPORT.exec(source);
  while (match !== null) {
    for (const part of (match[1] ?? "").split(",")) {
      const [local = "", alias] = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/);
      if (local.length > 0 && (alias ?? local) === name) {
        return { local, module: match[2] ?? "" };
      }
    }
    match = NAMED_REEXPORT.exec(source);
  }
  return null;
};

export const externalName = (
  source: string,
  importIndex: number,
  local: string
): string => {
  const clause = /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]/.exec(
    source.slice(importIndex, importIndex + 4096)
  );
  if (clause === null) return local;
  const aliased = new RegExp(`([A-Za-z_$][\\w$]*)\\s+as\\s+${local}\\b`).exec(
    clause[1] ?? ""
  );
  return aliased?.[1] ?? local;
};

const starReexports = (source: string): string[] => {
  const modules: string[] = [];
  STAR_REEXPORT.lastIndex = 0;
  let match = STAR_REEXPORT.exec(source);
  while (match !== null) {
    modules.push(match[1] ?? "");
    match = STAR_REEXPORT.exec(source);
  }
  return modules;
};

export const resolveHelperBody = (
  name: string,
  specifier: string,
  context: EvaluationContext
): HelperResolution => {
  const visited = new Set<string>();

  const follow = (
    wanted: string,
    module: string,
    fromPath: string,
    hops: number
  ): HelperResolution => {
    if (hops > MAX_HOPS) {
      return unresolved(
        `the re-export chain for "${wanted}" passes through more than ${MAX_HOPS} files`
      );
    }
    const resolution = context.resolveModule(module, fromPath);
    if (resolution.kind === "package") {
      return unresolved(
        `"${wanted}" comes from the package "${module}", and a package under node_modules is not followed`
      );
    }
    if (resolution.kind === "missing") {
      return unresolved(
        `the module "${module}" that holds "${wanted}" resolved to no file in this repository`
      );
    }
    if (visited.has(resolution.path)) {
      return unresolved(
        `the re-export chain for "${wanted}" returns to ${resolution.path}`
      );
    }
    visited.add(resolution.path);

    const facts = scanSource(resolution.source);
    const index = localDefinition(facts, wanted);
    if (index !== null) {
      return {
        kind: "body",
        path: resolution.path,
        facts: scanSource(
          isolateBody(
            resolution.source,
            index,
            definitionEnd(facts.masked, index)
          )
        ),
      };
    }

    const reimport = facts.imports.find((entry) =>
      entry.names.includes(wanted)
    );
    if (reimport !== undefined) {
      return follow(
        externalName(resolution.source, reimport.index, wanted),
        reimport.module,
        resolution.path,
        hops + 1
      );
    }
    const named = namedReexport(resolution.source, wanted);
    if (named !== null) {
      return follow(named.local, named.module, resolution.path, hops + 1);
    }
    for (const starModule of starReexports(resolution.source)) {
      const found = follow(wanted, starModule, resolution.path, hops + 1);
      if (found.kind === "body") return found;
    }
    return unresolved(
      `no definition of "${wanted}" was found in ${resolution.path}`
    );
  };

  return follow(name, specifier, context.filePath, 0);
};
