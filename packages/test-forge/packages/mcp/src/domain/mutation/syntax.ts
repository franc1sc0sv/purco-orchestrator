export type MutantViability =
  { viable: true } | { viable: false; reason: string };

const GENERIC_HEAD = /[A-Za-z0-9_$]/;

const TYPE_BODY = /[A-Za-z0-9_$.,:|&?'"`\s(){}[\]<>=]/;

const OPENING_DELIMITERS = "([{";

const CLOSING_DELIMITERS = ")]}";

const quotedSpanEnd = (line: string, start: number): number => {
  const quote = line[start];
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) return index + 1;
    index += 1;
  }
  return line.length;
};

const opensGeneric = (line: string, index: number): boolean =>
  index > 0 &&
  GENERIC_HEAD.test(line[index - 1] ?? "") &&
  line[index + 1] !== "=";

const genericSpan = (line: string, open: number): number[] | null => {
  const brackets = [open];
  let depth = 1;
  let index = open + 1;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      index = quotedSpanEnd(line, index);
      continue;
    }
    if (char === "=" && line[index + 1] === ">") {
      index += 2;
      continue;
    }
    if (!TYPE_BODY.test(char)) return null;
    if (char === "<") {
      if (line[index + 1] === "=") return null;
      brackets.push(index);
      depth += 1;
    }
    if (char === ">") {
      if (/\s/.test(line[index - 1] ?? " ")) return null;
      brackets.push(index);
      depth -= 1;
      if (depth === 0) return brackets;
    }
    index += 1;
  }
  return null;
};

export const genericBrackets = (line: string): ReadonlySet<number> => {
  const generic = new Set<number>();
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      index = quotedSpanEnd(line, index);
      continue;
    }
    if (char === "<" && opensGeneric(line, index)) {
      const span = genericSpan(line, index);
      if (span !== null) {
        for (const position of span) generic.add(position);
        index = (span[span.length - 1] ?? index) + 1;
        continue;
      }
    }
    index += 1;
  }
  return generic;
};

const closesGeneric = (line: string, index: number): boolean =>
  line[index + 1] !== "=" && line[index - 1] !== "=";

const walkCarriedGenerics = (
  line: string,
  openDepth: number,
  onClose: (index: number) => void,
): number => {
  let depth = openDepth;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      index = quotedSpanEnd(line, index);
      continue;
    }
    if (char === "<" && opensGeneric(line, index)) depth += 1;
    else if (char === ">" && depth > 0 && closesGeneric(line, index)) {
      onClose(index);
      depth -= 1;
    }
    index += 1;
  }
  return depth;
};

export const genericDepthAfter = (line: string, openDepth: number): number =>
  walkCarriedGenerics(line, openDepth, () => undefined);

export const carriedGenericBrackets = (
  line: string,
  openDepth: number,
): ReadonlySet<number> => {
  const positions = new Set<number>(genericBrackets(line));
  if (openDepth <= 0) return positions;
  walkCarriedGenerics(line, openDepth, (index) => positions.add(index));
  return positions;
};

const delimiterDelta = (line: string): number => {
  let delta = 0;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (char === "'" || char === '"' || char === "`") {
      index = quotedSpanEnd(line, index);
      continue;
    }
    if (OPENING_DELIMITERS.includes(char)) delta += 1;
    if (CLOSING_DELIMITERS.includes(char)) delta -= 1;
    index += 1;
  }
  return delta;
};

const hasGluedGeneric = (line: string): boolean =>
  [...genericBrackets(line)].some((position) => line[position + 1] === "=");

export const mutantViability = (
  before: string,
  after: string,
): MutantViability => {
  if (hasGluedGeneric(after) && !hasGluedGeneric(before)) {
    return {
      viable: false,
      reason:
        "the mutation glued an operator onto a type argument list, which no parser accepts",
    };
  }
  if (genericBrackets(after).size < genericBrackets(before).size) {
    return {
      viable: false,
      reason: "the mutation broke a type argument list the source line opened",
    };
  }
  if (delimiterDelta(after) !== delimiterDelta(before)) {
    return {
      viable: false,
      reason:
        "the mutation changed how many brackets the line leaves open, so the rest of the expression no longer closes",
    };
  }
  return { viable: true };
};
