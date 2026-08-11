export const MAX_QUOTE_CHARS = 200;

const SCAN_CACHE_LIMIT = 200;

export const CONTROL_KEYWORDS: ReadonlySet<string> = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "typeof",
  "delete",
  "void",
  "yield",
  "do",
  "else",
  "in",
  "of",
  "case",
  "import",
  "super",
  "with",
]);

export const TEST_DECLARERS: ReadonlySet<string> = new Set([
  "it",
  "test",
  "xit",
  "fit",
]);

export const SUITE_DECLARERS: ReadonlySet<string> = new Set([
  "describe",
  "suite",
  "xdescribe",
  "fdescribe",
]);

export const HOOK_NAMES: readonly string[] = [
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
  "before",
  "after",
];

const HOOK_SET: ReadonlySet<string> = new Set(HOOK_NAMES);

const ASSERTION_MODIFIERS: ReadonlySet<string> = new Set([
  "not",
  "resolves",
  "rejects",
]);

const NON_DECLARING_MEMBERS: ReadonlySet<string> = new Set([
  "step",
  "use",
  "slow",
  "setTimeout",
  "fixme",
  "extend",
  "info",
  "expect",
  "fail",
  "configure",
  ...HOOK_NAMES,
]);

export type DeclarationClass = "test" | "suite" | "hook" | "other";

export const classifyDeclaration = (callee: string): DeclarationClass => {
  const [base = "", ...members] = callee.split(".");
  if (SUITE_DECLARERS.has(base)) return "suite";
  if (!TEST_DECLARERS.has(base)) return HOOK_SET.has(base) ? "hook" : "other";
  if (members.includes("describe")) return "suite";
  if (members.some((member) => HOOK_SET.has(member))) return "hook";
  if (members.some((member) => NON_DECLARING_MEMBERS.has(member))) {
    return "other";
  }
  return "test";
};

export type CallSite = {
  callee: string;
  base: string;
  last: string;
  index: number;
  parenIndex: number;
  argsStart: number;
  argsEnd: number;
  awaited: boolean;
  isNew: boolean;
  line: number;
};

export type PropertyKeySite = {
  name: string;
  index: number;
  line: number;
  depth: number;
  shorthand: boolean;
  valueStart: number;
  valueIsObject: boolean;
};

export type ImportKind = "static" | "side-effect" | "require" | "dynamic";

export type ImportSite = {
  module: string;
  names: string[];
  kind: ImportKind;
  index: number;
  line: number;
};

export type DeclarationSite = {
  name: string;
  index: number;
  line: number;
};

export type JsxSite = {
  name: string;
  index: number;
  line: number;
};

export type AssertionSite = {
  matcher: string;
  modifiers: string[];
  index: number;
  line: number;
};

export type SuiteSite = {
  title: string;
  line: number;
  callee: string;
  depth: number;
};

export type TestSite = SuiteSite & {
  ancestors: string[];
};

export type SourceFacts = {
  source: string;
  masked: string;
  offsets: number[];
  lines: string[];
  lineCount: number;
  callSites: CallSite[];
  propertyKeys: PropertyKeySite[];
  imports: ImportSite[];
  declarations: DeclarationSite[];
  jsxElements: JsxSite[];
  assertions: AssertionSite[];
  describes: SuiteSite[];
  tests: TestSite[];
  maxDescribeDepth: number;
};

export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const skipQuoted = (source: string, start: number): number => {
  const quote = source.charAt(start);
  let index = start + 1;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote || character === "\n") return index + 1;
    index += 1;
  }
  return source.length;
};

const skipTemplate = (source: string, start: number): number => {
  let index = start + 1;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") return index + 1;
    if (character === "$" && source.charAt(index + 1) === "{") {
      index = skipBraces(source, index + 1);
      continue;
    }
    index += 1;
  }
  return source.length;
};

const skipBraces = (source: string, start: number): number => {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") {
      index = skipTemplate(source, index);
      continue;
    }
    if (character === "'" || character === '"') {
      index = skipQuoted(source, index);
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
};

export const skipRegexLiteral = (source: string, start: number): number => {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "\n") return -1;
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source.charAt(index))) {
        index += 1;
      }
      return index;
    }
    index += 1;
  }
  return -1;
};

export const readStringLiteral = (
  source: string,
  start: number
): string | null => {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source.charAt(cursor))) {
    cursor += 1;
  }
  const quote = source.charAt(cursor);
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  const end =
    quote === "`" ? skipTemplate(source, cursor) : skipQuoted(source, cursor);
  return source.slice(cursor + 1, end - 1);
};

const REGEX_PRECEDERS: ReadonlySet<string> = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "~",
  "^",
  "<",
  ">",
  "\n",
]);

const REGEX_PRECEDING_WORDS: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "do",
  "else",
  "yield",
  "await",
  "and",
  "or",
]);

export const maskSource = (source: string): string => {
  const characters = source.split("");
  const blank = (start: number, end: number): void => {
    for (
      let index = Math.max(0, start);
      index < Math.min(end, characters.length);
      index += 1
    ) {
      const character = characters[index];
      if (character !== "\n" && character !== "\r") characters[index] = " ";
    }
  };

  let index = 0;
  let lastSignificant = "";
  let lastWord = "";

  while (index < source.length) {
    const character = source.charAt(index);
    const following = source.charAt(index + 1);

    if (character === "/" && following === "/") {
      const end = source.indexOf("\n", index);
      blank(index, end === -1 ? source.length : end);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (character === "/" && following === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(index, end);
      index = end;
      continue;
    }
    if (character === "'" || character === '"') {
      const end = skipQuoted(source, index);
      blank(index + 1, end - 1);
      lastSignificant = character;
      lastWord = "";
      index = end;
      continue;
    }
    if (character === "`") {
      const end = skipTemplate(source, index);
      blank(index + 1, end - 1);
      lastSignificant = "`";
      lastWord = "";
      index = end;
      continue;
    }
    if (
      character === "/" &&
      (REGEX_PRECEDERS.has(lastSignificant) ||
        REGEX_PRECEDING_WORDS.has(lastWord))
    ) {
      const end = skipRegexLiteral(source, index);
      if (end !== -1) {
        blank(index, end);
        lastSignificant = "/";
        lastWord = "";
        index = end;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index;
      while (end < source.length && /[\w$]/.test(source.charAt(end))) end += 1;
      lastWord = source.slice(index, end);
      lastSignificant = source.charAt(end - 1);
      index = end;
      continue;
    }
    if (!/\s/.test(character)) {
      lastSignificant = character;
      lastWord = "";
    } else if (character === "\n") {
      lastSignificant = "\n";
      lastWord = "";
    }
    index += 1;
  }

  return characters.join("");
};

export const buildLineOffsets = (source: string): number[] => {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charAt(index) === "\n") offsets.push(index + 1);
  }
  return offsets;
};

export const lineOf = (offsets: readonly number[], index: number): number => {
  let low = 0;
  let high = offsets.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((offsets[middle] ?? 0) <= index) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, low);
};

export const matchBracket = (masked: string, openIndex: number): number => {
  const open = masked.charAt(openIndex);
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let index = openIndex; index < masked.length; index += 1) {
    const character = masked.charAt(index);
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const precedingWord = (masked: string, index: number): string => {
  const window = masked.slice(Math.max(0, index - 24), index);
  const match = /([A-Za-z_$][\w$]*)\s*$/.exec(window);
  return match?.[1] ?? "";
};

const precedingSignificant = (
  masked: string,
  index: number
): { character: string; index: number } => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = masked.charAt(cursor);
    if (!/\s/.test(character)) return { character, index: cursor };
  }
  return { character: "", index: -1 };
};

const nextSignificant = (
  masked: string,
  from: number
): { character: string; index: number } => {
  for (let cursor = from; cursor < masked.length; cursor += 1) {
    const character = masked.charAt(cursor);
    if (!/\s/.test(character)) return { character, index: cursor };
  }
  return { character: "", index: -1 };
};

const CALL_PATTERN = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;

const collectCallSites = (
  masked: string,
  offsets: readonly number[]
): CallSite[] => {
  const sites: CallSite[] = [];
  CALL_PATTERN.lastIndex = 0;
  let match = CALL_PATTERN.exec(masked);
  while (match !== null) {
    const callee = (match[1] ?? "").replace(/\s+/g, "");
    const segments = callee.split(".");
    const base = segments[0] ?? "";
    const last = segments[segments.length - 1] ?? "";
    if (
      !(segments.length === 1 && CONTROL_KEYWORDS.has(base)) &&
      base !== "new"
    ) {
      const parenIndex = match.index + match[0].length - 1;
      const closeIndex = matchBracket(masked, parenIndex);
      const previous = precedingWord(masked, match.index);
      sites.push({
        callee,
        base,
        last,
        index: match.index,
        parenIndex,
        argsStart: parenIndex + 1,
        argsEnd: closeIndex === -1 ? masked.length : closeIndex,
        awaited: previous === "await",
        isNew: previous === "new",
        line: lineOf(offsets, match.index),
      });
    }
    match = CALL_PATTERN.exec(masked);
  }
  return sites;
};

const OBJECT_LITERAL_PRECEDERS: ReadonlySet<string> = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "?",
  "&",
  "|",
]);

const isObjectLiteralStart = (masked: string, index: number): boolean => {
  const { character } = precedingSignificant(masked, index);
  if (character === "") return false;
  if (OBJECT_LITERAL_PRECEDERS.has(character)) return true;
  return precedingWord(masked, index) === "return";
};

const KEY_PATTERN = /^([A-Za-z_$][\w$]*|'[^'\n]*'|"[^"\n]*")\s*([:,}])/;

const collectPropertyKeys = (
  source: string,
  masked: string,
  offsets: readonly number[]
): PropertyKeySite[] => {
  const keys: PropertyKeySite[] = [];
  const stack: { character: string; isLiteral: boolean }[] = [];
  let index = 0;

  while (index < masked.length) {
    const character = masked.charAt(index);

    if (character === "{" || character === "(" || character === "[") {
      stack.push({
        character,
        isLiteral: character === "{" && isObjectLiteralStart(masked, index),
      });
      index += 1;
      continue;
    }

    if (character === "}" || character === ")" || character === "]") {
      stack.pop();
      index += 1;
      continue;
    }

    if (!/[A-Za-z_$'"]/.test(character)) {
      index += 1;
      continue;
    }

    const top = stack[stack.length - 1];
    const candidate = KEY_PATTERN.exec(masked.slice(index, index + 512));
    if (candidate === null) {
      while (index < masked.length && /[\w$]/.test(masked.charAt(index))) {
        index += 1;
      }
      index += 1;
      continue;
    }

    const raw = candidate[1] ?? "";
    const preceder = precedingSignificant(masked, index).character;
    if (top?.isLiteral === true && (preceder === "{" || preceder === ",")) {
      const quoted = raw.startsWith("'") || raw.startsWith('"');
      const shorthand = candidate[2] !== ":";
      const value = shorthand
        ? { character: "", index: -1 }
        : nextSignificant(masked, index + (candidate[0]?.length ?? 0));
      keys.push({
        name: quoted ? source.slice(index + 1, index + raw.length - 1) : raw,
        index,
        line: lineOf(offsets, index),
        depth: stack.filter((entry) => entry.isLiteral).length,
        shorthand,
        valueStart: value.index,
        valueIsObject: value.character === "{",
      });
    }

    index += raw.length;
  }

  return keys;
};

const IMPORT_CLAUSE_PATTERN =
  /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*(['"])([^'"]+)\2/g;
const IMPORT_BARE_PATTERN = /\bimport\s*(['"])([^'"]+)\1/g;
const REQUIRE_PATTERN = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

const parseImportNames = (clause: string): string[] => {
  const names: string[] = [];
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  if (namespace?.[1] !== undefined) names.push(namespace[1]);
  const braced = /\{([\s\S]*)\}/.exec(clause);
  if (braced?.[1] !== undefined) {
    for (const part of braced[1].split(",")) {
      const trimmed = part.trim().replace(/^type\s+/, "");
      if (trimmed.length === 0) continue;
      const aliased = /\bas\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
      names.push(aliased?.[1] ?? trimmed.split(/\s+/)[0] ?? "");
    }
  }
  const defaultName = clause
    .replace(/\{[\s\S]*\}/, "")
    .split(",")[0]
    ?.trim();
  if (
    defaultName !== undefined &&
    /^[A-Za-z_$][\w$]*$/.test(defaultName) &&
    !names.includes(defaultName)
  ) {
    names.unshift(defaultName);
  }
  return names.filter((name) => name.length > 0);
};

const collectImports = (
  source: string,
  offsets: readonly number[]
): ImportSite[] => {
  const imports: ImportSite[] = [];
  const scan = (
    pattern: RegExp,
    moduleGroup: number,
    kind: ImportKind,
    clauseGroup: number | null
  ): void => {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      imports.push({
        module: match[moduleGroup] ?? "",
        names:
          clauseGroup === null
            ? []
            : parseImportNames(match[clauseGroup] ?? ""),
        kind,
        index: match.index,
        line: lineOf(offsets, match.index),
      });
      match = pattern.exec(source);
    }
  };
  scan(IMPORT_CLAUSE_PATTERN, 3, "static", 1);
  scan(IMPORT_BARE_PATTERN, 2, "side-effect", null);
  scan(REQUIRE_PATTERN, 2, "require", null);
  scan(DYNAMIC_IMPORT_PATTERN, 2, "dynamic", null);
  const seen = new Set<string>();
  return imports.filter((entry) => {
    const key = `${entry.kind}:${entry.index}:${entry.module}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const DECLARATION_PATTERNS = [
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
];

const DESTRUCTURE_PATTERN = /\b(?:const|let|var)\s*(\{[^{}]*\}|\[[^[\]]*\])/g;

const collectDeclarations = (
  masked: string,
  offsets: readonly number[],
  imports: readonly ImportSite[]
): DeclarationSite[] => {
  const declarations: DeclarationSite[] = [];
  for (const pattern of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(masked);
    while (match !== null) {
      declarations.push({
        name: match[1] ?? "",
        index: match.index,
        line: lineOf(offsets, match.index),
      });
      match = pattern.exec(masked);
    }
  }
  DESTRUCTURE_PATTERN.lastIndex = 0;
  let destructured = DESTRUCTURE_PATTERN.exec(masked);
  while (destructured !== null) {
    const inner = (destructured[1] ?? "").slice(1, -1);
    for (const part of inner.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;
      const renamed = /:\s*([A-Za-z_$][\w$]*)/.exec(trimmed);
      const name =
        renamed?.[1] ?? /^\.{0,3}([A-Za-z_$][\w$]*)/.exec(trimmed)?.[1];
      if (name !== undefined) {
        declarations.push({
          name,
          index: destructured.index,
          line: lineOf(offsets, destructured.index),
        });
      }
    }
    destructured = DESTRUCTURE_PATTERN.exec(masked);
  }
  for (const entry of imports) {
    for (const name of entry.names) {
      declarations.push({ name, index: entry.index, line: entry.line });
    }
  }
  return declarations;
};

const JSX_PATTERN = /<([A-Z][\w.]*|[a-z][a-z0-9-]*)(?=[\s/>])/g;

const collectJsxElements = (
  masked: string,
  offsets: readonly number[]
): JsxSite[] => {
  const elements: JsxSite[] = [];
  JSX_PATTERN.lastIndex = 0;
  let match = JSX_PATTERN.exec(masked);
  while (match !== null) {
    const { character } = precedingSignificant(masked, match.index);
    if (character === "" || "(,={}[]:;?&|>+\n".includes(character)) {
      elements.push({
        name: match[1] ?? "",
        index: match.index,
        line: lineOf(offsets, match.index),
      });
    }
    match = JSX_PATTERN.exec(masked);
  }
  return elements;
};

const collectAssertions = (
  masked: string,
  callSites: readonly CallSite[]
): AssertionSite[] => {
  const assertions: AssertionSite[] = [];
  for (const site of callSites) {
    if (site.base !== "expect" && site.callee !== "expect") continue;
    const tail = masked.slice(site.argsEnd + 1, site.argsEnd + 120);
    const chain = /^((?:\s*\.\s*[A-Za-z_$][\w$]*)+)/.exec(tail);
    if (chain?.[1] === undefined) continue;
    const parts = chain[1]
      .split(".")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const modifiers = parts.filter((part) => ASSERTION_MODIFIERS.has(part));
    const matcher = parts.find((part) => !ASSERTION_MODIFIERS.has(part));
    if (matcher === undefined) continue;
    assertions.push({
      matcher,
      modifiers,
      index: site.index,
      line: site.line,
    });
  }
  return assertions;
};

const buildTestTree = (
  source: string,
  callSites: readonly CallSite[]
): { describes: SuiteSite[]; tests: TestSite[]; maxDescribeDepth: number } => {
  const suites = callSites
    .filter(
      (site) =>
        classifyDeclaration(site.callee) === "suite" &&
        readStringLiteral(source, site.argsStart) !== null
    )
    .map((site) => ({
      title: readStringLiteral(source, site.argsStart) ?? "",
      line: site.line,
      start: site.argsStart,
      end: site.argsEnd,
      callee: site.callee,
    }));

  const ancestorsOf = (index: number): typeof suites =>
    suites
      .filter((suite) => suite.start < index && index < suite.end)
      .sort((left, right) => left.start - right.start);

  const describes = suites.map((suite) => ({
    title: suite.title,
    line: suite.line,
    callee: suite.callee,
    depth: ancestorsOf(suite.start).length + 1,
  }));

  const tests = callSites
    .filter(
      (site) =>
        classifyDeclaration(site.callee) === "test" &&
        readStringLiteral(source, site.argsStart) !== null
    )
    .map((site) => {
      const ancestors = ancestorsOf(site.index);
      return {
        title: readStringLiteral(source, site.argsStart) ?? "",
        line: site.line,
        callee: site.callee,
        depth: ancestors.length,
        ancestors: ancestors.map((suite) => suite.title),
      };
    });

  return {
    describes,
    tests,
    maxDescribeDepth: describes.reduce(
      (max, entry) => Math.max(max, entry.depth),
      0
    ),
  };
};

const cache = new Map<string, SourceFacts>();

export const scanSource = (source: string): SourceFacts => {
  const cached = cache.get(source);
  if (cached) return cached;

  const masked = maskSource(source);
  const offsets = buildLineOffsets(source);
  const lines = source.split(/\r?\n/);
  const callSites = collectCallSites(masked, offsets);
  const tree = buildTestTree(source, callSites);

  const facts: SourceFacts = {
    source,
    masked,
    offsets,
    lines,
    lineCount: lines.length,
    callSites,
    propertyKeys: collectPropertyKeys(source, masked, offsets),
    imports: collectImports(source, offsets),
    declarations: [],
    jsxElements: collectJsxElements(masked, offsets),
    assertions: collectAssertions(masked, callSites),
    describes: tree.describes,
    tests: tree.tests,
    maxDescribeDepth: tree.maxDescribeDepth,
  };
  facts.declarations = collectDeclarations(masked, offsets, facts.imports);

  const oldest = cache.keys().next();
  if (cache.size >= SCAN_CACHE_LIMIT && oldest.done === false) {
    cache.delete(oldest.value);
  }
  cache.set(source, facts);
  return facts;
};

export const quoteAt = (facts: SourceFacts, index: number): string => {
  const line = lineOf(facts.offsets, index);
  const text = (facts.lines[line - 1] ?? "").trim();
  return text.length > MAX_QUOTE_CHARS
    ? `${text.slice(0, MAX_QUOTE_CHARS)}…`
    : text;
};
