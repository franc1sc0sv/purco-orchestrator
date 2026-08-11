import { carriedGenericBrackets } from "./syntax.ts";
import type { MutationOperator } from "test-forge-contracts/mutation";

export type LineMutation = {
  operator: MutationOperator;
  after: string;
};

export type EnumIndex = ReadonlyMap<string, ReadonlySet<string>>;

export type MutationContext = {
  openGenericDepth: number;
  nextLine: string | undefined;
  enums: EnumIndex;
  literals: readonly string[];
};

export type MutationTransform = (
  line: string,
  context: MutationContext,
) => LineMutation[];

export type OperatorCounts = { total: number } & Partial<
  Record<MutationOperator, number>
>;

type ArgumentShape =
  | "string-literal"
  | "number-literal"
  | "boolean-literal"
  | "id"
  | "date"
  | "name"
  | "amount";

const group = (match: RegExpExecArray, index: number): string =>
  match[index] ?? "";

export const isCodeLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*")
  )
    return false;
  if (trimmed.startsWith("import ") || trimmed.startsWith("export type"))
    return false;
  return true;
};

export const replaceOccurrence = (
  line: string,
  needle: string,
  replacement: string,
  occurrence: number,
): string | null => {
  let seen = 0;
  let index = line.indexOf(needle);
  while (index !== -1) {
    if (seen === occurrence)
      return (
        line.slice(0, index) + replacement + line.slice(index + needle.length)
      );
    seen += 1;
    index = line.indexOf(needle, index + 1);
  }
  return null;
};

const BOUNDARY_SWAPS: readonly (readonly [string, string])[] = [
  [">=", ">"],
  ["<=", "<"],
  [">", ">="],
  ["<", "<="],
];

export const boundarySwaps = (
  line: string,
  openGenericDepth = 0,
): LineMutation[] => {
  const produced: LineMutation[] = [];
  const generic = carriedGenericBrackets(line, openGenericDepth);
  for (const [needle, replacement] of BOUNDARY_SWAPS) {
    const head = needle[0] ?? "";
    let occurrence = 0;
    let index = line.indexOf(needle);
    while (index !== -1) {
      const before = line[index - 1] ?? " ";
      const after = line[index + needle.length] ?? " ";
      const isArrow = needle === ">" && before === "=";
      const isShift = before === head || after === head;
      const isGeneric =
        needle.length === 1 &&
        (generic.has(index) ||
          (/[A-Za-z0-9_]/.test(before) &&
            /[A-Za-z0-9_ ]/.test(after) &&
            !/\s/.test(before)));
      const alreadyCompound = needle.length === 1 && after === "=";
      if (!isArrow && !isShift && !isGeneric && !alreadyCompound) {
        const mutated = replaceOccurrence(
          line,
          needle,
          replacement,
          occurrence,
        );
        if (mutated && mutated !== line)
          produced.push({ operator: "boundary-swap", after: mutated });
      }
      occurrence += 1;
      index = line.indexOf(needle, index + 1);
    }
  }
  return produced;
};

const CONDITION_FLIPS: readonly (readonly [string, string])[] = [
  ["===", "!=="],
  ["!==", "==="],
  ["&&", "||"],
  ["||", "&&"],
];

export const conditionFlips = (line: string): LineMutation[] => {
  const produced: LineMutation[] = [];
  for (const [needle, replacement] of CONDITION_FLIPS) {
    let occurrence = 0;
    let index = line.indexOf(needle);
    while (index !== -1) {
      const mutated = replaceOccurrence(line, needle, replacement, occurrence);
      if (mutated && mutated !== line)
        produced.push({ operator: "condition-flip", after: mutated });
      occurrence += 1;
      index = line.indexOf(needle, index + 1);
    }
  }
  const negation = /(if\s*\(\s*)!(?![=])/.exec(line);
  if (negation) {
    produced.push({
      operator: "condition-flip",
      after:
        line.slice(0, negation.index) +
        group(negation, 1) +
        line.slice(negation.index + group(negation, 0).length),
    });
  }
  return produced;
};

export const guardRemovals = (
  line: string,
  nextLine: string | undefined,
): LineMutation[] => {
  const match = /^(\s*)if\s*\(([\s\S]+)\)\s*(\{?)\s*(.*)$/.exec(line);
  if (!match) return [];
  const tail = group(match, 4);
  const body = tail.trim() !== "" ? tail : (nextLine ?? "").trim();
  if (!/^(return|throw|continue|break)\b/.test(body)) return [];
  if (group(match, 2).trim() === "false") return [];
  return [
    {
      operator: "guard-removal",
      after: `${group(match, 1)}if (false) ${group(match, 3)}${tail}`.replace(
        /\s+$/,
        "",
      ),
    },
  ];
};

export const emptyResults = (line: string): LineMutation[] => {
  const produced: LineMutation[] = [];
  const arrayReturn = /^(\s*return\s+)\[[^\]]/.exec(line);
  if (arrayReturn)
    produced.push({
      operator: "empty-result",
      after: `${group(arrayReturn, 1)}[]`,
    });
  const collectionReturn =
    /^(\s*return\s+)(?!\[\s*\]).*(findMany|\.filter\(|\.map\(|Promise\.all|selectAll\(|execute\(\))/.exec(
      line,
    );
  if (collectionReturn)
    produced.push({
      operator: "empty-result",
      after: `${group(collectionReturn, 1)}[]`,
    });
  const objectReturn = /^(\s*return\s+)\{[^}]/.exec(line);
  if (objectReturn)
    produced.push({
      operator: "empty-result",
      after: `${group(objectReturn, 1)}{}`,
    });
  return produced;
};

export const argumentShape = (argument: string): ArgumentShape | null => {
  const value = argument.trim();
  if (/^["'`]/.test(value)) return "string-literal";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number-literal";
  if (/^(true|false)$/.test(value)) return "boolean-literal";
  const identifier = /([A-Za-z0-9_$]+)$/.exec(value);
  if (!identifier) return null;
  const name = group(identifier, 1);
  if (/Id$/.test(name) || name === "id") return "id";
  if (/(Date|At)$/.test(name)) return "date";
  if (/(Name|Label|Title)$/.test(name)) return "name";
  if (/(Count|Total|Amount|Cents)$/.test(name)) return "amount";
  return null;
};

export const argumentSwaps = (line: string): LineMutation[] => {
  const produced: LineMutation[] = [];
  const call = /([A-Za-z0-9_$.]+)\(([^()]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(line)) !== null) {
    const rawArguments = group(match, 2);
    if (!rawArguments.includes(",")) continue;
    const parts = rawArguments.split(",");
    for (let index = 0; index + 1 < parts.length; index += 1) {
      const first = parts[index];
      const second = parts[index + 1];
      if (first === undefined || second === undefined) continue;
      const left = argumentShape(first);
      const right = argumentShape(second);
      if (!left || left !== right) continue;
      if (first.trim() === second.trim()) continue;
      const swapped = [...parts];
      swapped[index] = second;
      swapped[index + 1] = first;
      const mutatedCall = `${group(match, 1)}(${swapped.join(",")})`;
      produced.push({
        operator: "argument-swap",
        after:
          line.slice(0, match.index) +
          mutatedCall +
          line.slice(match.index + group(match, 0).length),
      });
    }
  }
  return produced;
};

export const awaitRemovals = (line: string): LineMutation[] => {
  if (/\bfor\s+await\b/.test(line)) return [];
  const produced: LineMutation[] = [];
  const occurrences = [...line.matchAll(/\bawait\s+/g)].length;
  for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
    const mutated = replaceOccurrence(line, "await ", "", occurrence);
    if (mutated && mutated !== line)
      produced.push({ operator: "await-removal", after: mutated });
  }
  return produced;
};

export const buildEnumIndex = (texts: readonly string[]): EnumIndex => {
  const members = new Map<string, Set<string>>();
  const qualified = /\b([A-Z][A-Za-z0-9_]*)\.([A-Z][A-Z0-9_]{2,})\b/g;
  const declared = /enum\s+([A-Za-z0-9_]+)\s*\{([^}]*)\}/g;
  const memberSet = (name: string): Set<string> => {
    const existing = members.get(name);
    if (existing) return existing;
    const created = new Set<string>();
    members.set(name, created);
    return created;
  };
  for (const text of texts) {
    let match: RegExpExecArray | null;
    while ((match = qualified.exec(text)) !== null)
      memberSet(group(match, 1)).add(group(match, 2));
    while ((match = declared.exec(text)) !== null) {
      const set = memberSet(group(match, 1));
      for (const entry of group(match, 2).split(",")) {
        const name = /([A-Za-z0-9_]+)\s*(=|$)/.exec(entry.trim());
        if (name) set.add(group(name, 1));
      }
    }
  }
  return members;
};

export const collectLiteralPool = (texts: readonly string[]): string[] => [
  ...new Set(
    texts.flatMap((text) =>
      [...text.matchAll(/(["'])([A-Z][A-Z0-9_]{2,})\1/g)].map(
        (match) => match[2] ?? "",
      ),
    ),
  ),
];

export const enumShifts = (
  line: string,
  enums: EnumIndex,
  literals: readonly string[],
): LineMutation[] => {
  const produced: LineMutation[] = [];
  const qualified = /\b([A-Z][A-Za-z0-9_]*)\.([A-Z][A-Z0-9_]{2,})\b/g;
  let match: RegExpExecArray | null;
  while ((match = qualified.exec(line)) !== null) {
    const holder = group(match, 1);
    const member = group(match, 2);
    const alternative = [...(enums.get(holder) ?? [])].find(
      (option) => option !== member,
    );
    if (alternative === undefined) continue;
    produced.push({
      operator: "enum-shift",
      after:
        line.slice(0, match.index) +
        `${holder}.${alternative}` +
        line.slice(match.index + group(match, 0).length),
    });
  }
  const literal = /(["'])([A-Z][A-Z0-9_]{2,})\1/g;
  while ((match = literal.exec(line)) !== null) {
    const quote = group(match, 1);
    const value = group(match, 2);
    const alternative = literals.find((option) => option !== value);
    if (alternative === undefined) continue;
    produced.push({
      operator: "enum-shift",
      after:
        line.slice(0, match.index) +
        `${quote}${alternative}${quote}` +
        line.slice(match.index + group(match, 0).length),
    });
  }
  return produced;
};

export const shiftIsoDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const dateShifts = (line: string): LineMutation[] => {
  const produced: LineMutation[] = [];
  const isoLiteral = /(["'])(\d{4}-\d{2}-\d{2})((?:T[^"'`]*)?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = isoLiteral.exec(line)) !== null) {
    const quote = group(match, 1);
    const shifted = `${quote}${shiftIsoDate(group(match, 2))}${group(
      match,
      3,
    )}${quote}`;
    produced.push({
      operator: "date-shift",
      after:
        line.slice(0, match.index) +
        shifted +
        line.slice(match.index + group(match, 0).length),
    });
  }
  const helper =
    /\b(addDays|subDays|addBusinessDays|addMonths|subMonths|addHours|setDate)\(([^,()]+),\s*(-?\d+)\s*\)/g;
  while ((match = helper.exec(line)) !== null) {
    const shifted = `${group(match, 1)}(${group(match, 2)}, ${
      Number(group(match, 3)) + 1
    })`;
    produced.push({
      operator: "date-shift",
      after:
        line.slice(0, match.index) +
        shifted +
        line.slice(match.index + group(match, 0).length),
    });
  }
  const getDateArithmetic = /getDate\(\)\s*([+-])\s*(\d+)/g;
  while ((match = getDateArithmetic.exec(line)) !== null) {
    const shifted = `getDate() ${group(match, 1)} ${
      Number(group(match, 2)) + 1
    }`;
    produced.push({
      operator: "date-shift",
      after:
        line.slice(0, match.index) +
        shifted +
        line.slice(match.index + group(match, 0).length),
    });
  }
  return produced;
};

export const MUTATION_TRANSFORMS: Record<MutationOperator, MutationTransform> =
  {
    "boundary-swap": (line, context) =>
      boundarySwaps(line, context.openGenericDepth),
    "condition-flip": (line) => conditionFlips(line),
    "guard-removal": (line, context) => guardRemovals(line, context.nextLine),
    "empty-result": (line) => emptyResults(line),
    "argument-swap": (line) => argumentSwaps(line),
    "await-removal": (line) => awaitRemovals(line),
    "enum-shift": (line, context) =>
      enumShifts(line, context.enums, context.literals),
    "date-shift": (line) => dateShifts(line),
  };

export const mutateLine = (
  line: string,
  context: MutationContext,
): LineMutation[] => {
  if (!isCodeLine(line)) return [];
  return Object.values(MUTATION_TRANSFORMS)
    .flatMap((transform) => transform(line, context))
    .filter((mutation) => mutation.after !== line);
};

export const mutantKey = (
  file: string,
  line: number,
  mutation: LineMutation,
): string => `${file}|${line}|${mutation.operator}|${mutation.after}`;

export const countByOperator = (
  mutants: readonly { operator: MutationOperator }[],
): OperatorCounts => {
  const counts: OperatorCounts = { total: mutants.length };
  for (const mutant of mutants)
    counts[mutant.operator] = (counts[mutant.operator] ?? 0) + 1;
  return counts;
};
