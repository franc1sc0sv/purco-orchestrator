import { splitCheck } from "../codex/check-expression.ts";
import type { EvaluationContext } from "./helper-resolution.ts";
import { externalName, resolveHelperBody } from "./helper-resolution.ts";
import type { SourceFacts } from "./source-facts.ts";
import {
  escapeRegExp,
  lineOf,
  matchBracket,
  quoteAt,
  skipQuoted,
  skipRegexLiteral,
} from "./source-facts.ts";

export const MAX_SITES = 50;

export class CheckError extends Error {}

export type Site = {
  line: number;
  quote: string;
  index: number;
};

export type Value =
  | { type: "sites"; sites: Site[] }
  | { type: "bool"; value: boolean; sites: readonly Site[] }
  | { type: "num"; value: number; sites: readonly Site[] }
  | { type: "str"; value: string; sites: readonly Site[] }
  | { type: "regex"; source: string; flags: string; sites: readonly Site[] };

type Token =
  | { type: "regex"; source: string; flags: string }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string };

const siteAt = (facts: SourceFacts, index: number): Site => ({
  line: lineOf(facts.offsets, index),
  quote: quoteAt(facts, index),
  index,
});

const dedupeSites = (sites: readonly Site[]): Site[] => {
  const seen = new Set<string>();
  const unique: Site[] = [];
  for (const site of sites) {
    const key = `${site.line}:${site.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(site);
  }
  return unique.sort((left, right) => left.index - right.index);
};

const sitesValue = (sites: readonly Site[]): Value => ({
  type: "sites",
  sites: dedupeSites(sites),
});

const boolValue = (value: boolean): Value => ({
  type: "bool",
  value,
  sites: [],
});

const numberValue = (value: number): Value => ({
  type: "num",
  value,
  sites: [],
});

export const truth = (value: Value): boolean => {
  if (value.type === "sites") return value.sites.length > 0;
  if (value.type === "num") return value.value !== 0;
  if (value.type === "str") return value.value.length > 0;
  if (value.type === "regex") return true;
  return value.value;
};

const numericOf = (value: Value): number => {
  if (value.type === "num") return value.value;
  if (value.type === "sites") return value.sites.length;
  return truth(value) ? 1 : 0;
};

const compileNameMatcher = (value: Value): ((candidate: string) => boolean) => {
  if (value.type === "regex") {
    const pattern = new RegExp(value.source, value.flags);
    return (candidate) => pattern.test(candidate);
  }
  if (value.type !== "str") {
    throw new CheckError("expected a string or a regular expression matcher");
  }
  if (value.value.includes("*")) {
    const pattern = new RegExp(
      `^${value.value.split("*").map(escapeRegExp).join(".*")}$`
    );
    return (candidate) => pattern.test(candidate);
  }
  const literal = value.value;
  return (candidate) => candidate === literal;
};

const compileTextMatcher = (value: Value): ((candidate: string) => boolean) => {
  if (value.type === "regex") {
    const pattern = new RegExp(value.source, value.flags);
    return (candidate) => pattern.test(candidate);
  }
  if (value.type !== "str") {
    throw new CheckError("expected a string or a regular expression matcher");
  }
  const needle = value.value;
  return (candidate) => candidate.includes(needle);
};

const scanText = (
  facts: SourceFacts,
  haystack: string,
  matcher: Value
): Site[] => {
  const sites: Site[] = [];
  if (matcher.type === "regex") {
    const flags = matcher.flags.includes("g")
      ? matcher.flags
      : `${matcher.flags}g`;
    const pattern = new RegExp(matcher.source, flags);
    let match = pattern.exec(haystack);
    while (match !== null) {
      sites.push(siteAt(facts, match.index));
      if (match[0].length === 0) pattern.lastIndex += 1;
      match = pattern.exec(haystack);
    }
    return sites;
  }
  if (matcher.type !== "str") {
    throw new CheckError("text() expects a string or a regular expression");
  }
  let from = haystack.indexOf(matcher.value);
  while (from !== -1) {
    sites.push(siteAt(facts, from));
    from = haystack.indexOf(
      matcher.value,
      from + Math.max(1, matcher.value.length)
    );
  }
  return sites;
};

const requireArgs = (
  name: string,
  args: readonly Value[],
  min: number,
  max: number
): void => {
  if (args.length < min || args.length > max) {
    throw new CheckError(
      `${name}() expects between ${min} and ${max} arguments, received ${args.length}`
    );
  }
};

const argAt = (
  name: string,
  args: readonly Value[],
  position: number
): Value => {
  const value = args[position];
  if (value === undefined) {
    throw new CheckError(`${name}() is missing argument ${position + 1}`);
  }
  return value;
};

type CheckFunction = (
  args: readonly Value[],
  facts: SourceFacts,
  context: EvaluationContext | null
) => Value;

const helperSites = (
  facts: SourceFacts,
  name: string,
  index: number
): Site[] => {
  const calls = facts.callSites
    .filter((site) => site.base === name)
    .map((site) => siteAt(facts, site.index));
  return calls.length > 0 ? calls : [siteAt(facts, index)];
};

const helperBody: CheckFunction = (args, facts, context) => {
  requireArgs("helperBody", args, 2, 2);
  const matches = compileNameMatcher(argAt("helperBody", args, 0));
  const predicate = argAt("helperBody", args, 1);
  if (predicate.type !== "str") {
    throw new CheckError(
      `helperBody() expects its predicate as a string, for example helperBody("anchorDenverClock", "calls('vi.useFakeTimers')")`
    );
  }
  if (context === null) {
    throw new CheckError(
      "helperBody() follows a helper one level only, so it cannot run inside another helper body"
    );
  }

  const sites: Site[] = [];
  const failures: string[] = [];
  for (const entry of facts.imports) {
    for (const name of entry.names.filter(matches)) {
      const resolved = resolveHelperBody(
        externalName(facts.source, entry.index, name),
        entry.module,
        context
      );
      if (resolved.kind === "unresolved") {
        failures.push(resolved.reason);
        continue;
      }
      if (truth(evaluateExpression(predicate.value, resolved.facts))) {
        sites.push(...helperSites(facts, name, entry.index));
      }
    }
  }
  if (sites.length === 0 && failures.length > 0) {
    throw new CheckError(
      `helperBody() cannot determine an answer: ${failures.join("; ")}`
    );
  }
  return sitesValue(sites);
};

const objectKeys: CheckFunction = (args, facts) => {
  requireArgs("objectKeys", args, 2, 2);
  const matchesProperty = compileNameMatcher(argAt("objectKeys", args, 0));
  const matchesKey = compileNameMatcher(argAt("objectKeys", args, 1));
  const ranges = facts.propertyKeys
    .filter((entry) => entry.valueIsObject && matchesProperty(entry.name))
    .map((entry) => ({
      start: entry.valueStart,
      end: matchBracket(facts.masked, entry.valueStart),
    }))
    .filter((range) => range.end !== -1);
  return sitesValue(
    facts.propertyKeys
      .filter(
        (entry) =>
          matchesKey(entry.name) &&
          ranges.some(
            (range) => range.start < entry.index && entry.index < range.end
          )
      )
      .map((entry) => siteAt(facts, entry.index))
  );
};

const FUNCTIONS: Readonly<Record<string, CheckFunction>> = {
  calls: (args, facts) => {
    requireArgs("calls", args, 1, 1);
    const matches = compileNameMatcher(argAt("calls", args, 0));
    return sitesValue(
      facts.callSites
        .filter((site) => matches(site.callee))
        .map((site) => siteAt(facts, site.index))
    );
  },
  awaitedCalls: (args, facts) => {
    requireArgs("awaitedCalls", args, 1, 1);
    const matches = compileNameMatcher(argAt("awaitedCalls", args, 0));
    return sitesValue(
      facts.callSites
        .filter((site) => site.awaited && matches(site.callee))
        .map((site) => siteAt(facts, site.index))
    );
  },
  unawaitedCalls: (args, facts) => {
    requireArgs("unawaitedCalls", args, 1, 1);
    const matches = compileNameMatcher(argAt("unawaitedCalls", args, 0));
    return sitesValue(
      facts.callSites
        .filter((site) => !site.awaited && matches(site.callee))
        .map((site) => siteAt(facts, site.index))
    );
  },
  newExpressions: (args, facts) => {
    requireArgs("newExpressions", args, 1, 1);
    const matches = compileNameMatcher(argAt("newExpressions", args, 0));
    return sitesValue(
      facts.callSites
        .filter((site) => site.isNew && matches(site.callee))
        .map((site) => siteAt(facts, site.index))
    );
  },
  imports: (args, facts) => {
    requireArgs("imports", args, 1, 1);
    const matches = compileNameMatcher(argAt("imports", args, 0));
    return sitesValue(
      facts.imports
        .filter((entry) => matches(entry.module))
        .map((entry) => siteAt(facts, entry.index))
    );
  },
  importedNames: (args, facts) => {
    requireArgs("importedNames", args, 1, 1);
    const matches = compileNameMatcher(argAt("importedNames", args, 0));
    return sitesValue(
      facts.imports
        .filter((entry) => entry.names.some((name) => matches(name)))
        .map((entry) => siteAt(facts, entry.index))
    );
  },
  titles: (args, facts) => {
    requireArgs("titles", args, 1, 1);
    const matches = compileTextMatcher(argAt("titles", args, 0));
    return sitesValue(
      facts.tests
        .filter((entry) => matches(entry.title))
        .map((entry) => ({
          line: entry.line,
          quote: entry.title,
          index: facts.offsets[entry.line - 1] ?? 0,
        }))
    );
  },
  describes: (args, facts) => {
    requireArgs("describes", args, 1, 1);
    const matches = compileTextMatcher(argAt("describes", args, 0));
    return sitesValue(
      facts.describes
        .filter((entry) => matches(entry.title))
        .map((entry) => ({
          line: entry.line,
          quote: entry.title,
          index: facts.offsets[entry.line - 1] ?? 0,
        }))
    );
  },
  identifiers: (args, facts) => {
    requireArgs("identifiers", args, 1, 1);
    const matches = compileNameMatcher(argAt("identifiers", args, 0));
    return sitesValue(
      facts.declarations
        .filter((entry) => matches(entry.name))
        .map((entry) => siteAt(facts, entry.index))
    );
  },
  props: (args, facts) => {
    requireArgs("props", args, 1, 1);
    const matches = compileNameMatcher(argAt("props", args, 0));
    return sitesValue(
      facts.propertyKeys
        .filter((entry) => matches(entry.name))
        .map((entry) => siteAt(facts, entry.index))
    );
  },
  objectKeys,
  helperBody,
  whereKeys: (args, facts, context) => {
    requireArgs("whereKeys", args, 1, 1);
    return objectKeys(
      [{ type: "str", value: "where", sites: [] }, argAt("whereKeys", args, 0)],
      facts,
      context
    );
  },
  args: (args, facts) => {
    requireArgs("args", args, 2, 2);
    const matchesCallee = compileNameMatcher(argAt("args", args, 0));
    const matchesText = compileTextMatcher(argAt("args", args, 1));
    return sitesValue(
      facts.callSites
        .filter(
          (site) =>
            matchesCallee(site.callee) &&
            matchesText(facts.source.slice(site.argsStart, site.argsEnd))
        )
        .map((site) => siteAt(facts, site.index))
    );
  },
  text: (args, facts) => {
    requireArgs("text", args, 1, 1);
    return sitesValue(scanText(facts, facts.masked, argAt("text", args, 0)));
  },
  rawText: (args, facts) => {
    requireArgs("rawText", args, 1, 1);
    return sitesValue(scanText(facts, facts.source, argAt("rawText", args, 0)));
  },
  jsx: (args, facts) => {
    requireArgs("jsx", args, 1, 1);
    const matches = compileNameMatcher(argAt("jsx", args, 0));
    return sitesValue(
      facts.jsxElements
        .filter((entry) => matches(entry.name))
        .map((entry) => siteAt(facts, entry.index))
    );
  },
  lineCount: (args, facts) => {
    requireArgs("lineCount", args, 0, 0);
    return numberValue(facts.lineCount);
  },
  testCount: (args, facts) => {
    requireArgs("testCount", args, 0, 0);
    return numberValue(facts.tests.length);
  },
  describeDepth: (args, facts) => {
    requireArgs("describeDepth", args, 0, 0);
    return numberValue(facts.maxDescribeDepth);
  },
  count: (args) => {
    requireArgs("count", args, 1, 1);
    return numberValue(numericOf(argAt("count", args, 0)));
  },
  any: (args) => {
    requireArgs("any", args, 1, 1);
    return boolValue(truth(argAt("any", args, 0)));
  },
  none: (args) => {
    requireArgs("none", args, 1, 1);
    return boolValue(!truth(argAt("none", args, 0)));
  },
};

const PAIR_OPERATORS = ["&&", "||", ">=", "<=", "==", "!="];

const COMPARISONS = [">", "<", ">=", "<=", "==", "!="];

const tokenize = (input: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const character = input.charAt(index);
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/") {
      const end = skipRegexLiteral(input, index);
      if (end === -1) {
        throw new CheckError("unterminated regular expression in expression");
      }
      const body = input.slice(index, end);
      const lastSlash = body.lastIndexOf("/");
      tokens.push({
        type: "regex",
        source: body.slice(1, lastSlash),
        flags: body.slice(lastSlash + 1),
      });
      index = end;
      continue;
    }
    if (character === "'" || character === '"') {
      const end = skipQuoted(input, index);
      tokens.push({
        type: "string",
        value: input.slice(index + 1, end - 1).replace(/\\(.)/g, "$1"),
      });
      index = end;
      continue;
    }
    if (/[0-9]/.test(character)) {
      let end = index;
      while (end < input.length && /[0-9.]/.test(input.charAt(end))) end += 1;
      tokens.push({ type: "number", value: Number(input.slice(index, end)) });
      index = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index;
      while (end < input.length && /[\w$]/.test(input.charAt(end))) end += 1;
      tokens.push({ type: "ident", value: input.slice(index, end) });
      index = end;
      continue;
    }
    const pair = input.slice(index, index + 2);
    if (PAIR_OPERATORS.includes(pair)) {
      tokens.push({ type: "op", value: pair });
      index += 2;
      continue;
    }
    if ("()!,><".includes(character)) {
      tokens.push({ type: "op", value: character });
      index += 1;
      continue;
    }
    throw new CheckError(`unexpected character '${character}' in expression`);
  }
  return tokens;
};

const compare = (operator: string, left: number, right: number): boolean => {
  if (operator === ">") return left > right;
  if (operator === "<") return left < right;
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === "==") return left === right;
  return left !== right;
};

const combine = (kept: readonly Value[]): Value => {
  const sites = kept.flatMap((value) => [...value.sites]);
  return sites.length > 0 ? sitesValue(sites) : boolValue(true);
};

const evaluateTokens = (
  tokens: readonly Token[],
  facts: SourceFacts,
  context: EvaluationContext | null
): Value => {
  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const ahead = (): string => {
    const token = tokens[position];
    if (token === undefined) return "";
    return token.type === "regex"
      ? `/${token.source}/${token.flags}`
      : String(token.value);
  };
  const consume = (value: string): void => {
    const token = tokens[position];
    if (token === undefined || ahead() !== value) {
      throw new CheckError(`expected '${value}' in expression`);
    }
    position += 1;
  };

  const parsePrimary = (): Value => {
    const token = peek();
    if (token === undefined) {
      throw new CheckError("unexpected end of expression");
    }
    if (token.type === "string") {
      position += 1;
      return { type: "str", value: token.value, sites: [] };
    }
    if (token.type === "regex") {
      position += 1;
      return {
        type: "regex",
        source: token.source,
        flags: token.flags,
        sites: [],
      };
    }
    if (token.type === "number") {
      position += 1;
      return numberValue(token.value);
    }
    if (token.type === "op" && token.value === "(") {
      position += 1;
      const value = parseOr();
      consume(")");
      return value;
    }
    if (token.type === "ident") {
      position += 1;
      if (token.value === "true") return boolValue(true);
      if (token.value === "false") return boolValue(false);
      const handler = FUNCTIONS[token.value];
      if (handler === undefined) {
        throw new CheckError(`unknown function '${token.value}'`);
      }
      consume("(");
      const args: Value[] = [];
      if (ahead() !== ")") {
        args.push(parseOr());
        while (ahead() === ",") {
          position += 1;
          args.push(parseOr());
        }
      }
      consume(")");
      return handler(args, facts, context);
    }
    throw new CheckError(`unexpected token '${token.value}' in expression`);
  };

  const parseUnary = (): Value => {
    const token = peek();
    if (token?.type === "op" && token.value === "!") {
      position += 1;
      return boolValue(!truth(parseUnary()));
    }
    return parsePrimary();
  };

  const parseComparison = (): Value => {
    const left = parseUnary();
    const token = peek();
    if (
      token === undefined ||
      token.type !== "op" ||
      !COMPARISONS.includes(token.value)
    ) {
      return left;
    }
    position += 1;
    const right = parseUnary();
    return boolValue(compare(token.value, numericOf(left), numericOf(right)));
  };

  const parseAnd = (): Value => {
    let left = parseComparison();
    while (ahead() === "&&") {
      position += 1;
      const right = parseComparison();
      left =
        truth(left) && truth(right) ? combine([left, right]) : boolValue(false);
    }
    return left;
  };

  const parseOr = (): Value => {
    let left = parseAnd();
    while (ahead() === "||") {
      position += 1;
      const right = parseAnd();
      const kept = [left, right].filter((value) => truth(value));
      left = kept.length > 0 ? combine(kept) : boolValue(false);
    }
    return left;
  };

  const value = parseOr();
  if (position !== tokens.length) {
    throw new CheckError("trailing tokens in expression");
  }
  return value;
};

export const evaluateExpression = (
  expression: string,
  facts: SourceFacts,
  context: EvaluationContext | null = null
): Value => evaluateTokens(tokenize(expression), facts, context);

export const evaluateGrep = (pattern: string, facts: SourceFacts): Value => {
  const delimited = /^\/([\s\S]*)\/([a-z]*)$/.exec(pattern.trim());
  return sitesValue(
    scanText(facts, facts.source, {
      type: "regex",
      source: delimited?.[1] ?? pattern,
      flags: delimited?.[2] ?? "",
      sites: [],
    })
  );
};

export const evaluateCheck = (
  check: string,
  facts: SourceFacts,
  context: EvaluationContext | null = null
): Value => {
  const part = splitCheck(check);
  return part.kind === "grep"
    ? evaluateGrep(part.body, facts)
    : evaluateExpression(part.body, facts, context);
};
