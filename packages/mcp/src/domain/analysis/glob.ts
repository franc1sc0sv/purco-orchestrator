import { escapeRegExp } from "./source-facts.ts";

export const corpusGlobToRegExp = (glob: string): RegExp => {
  let pattern = "^";
  let index = 0;
  while (index < glob.length) {
    const character = glob.charAt(index);
    if (character === "*") {
      if (glob.charAt(index + 1) === "*") {
        if (glob.charAt(index + 2) === "/") {
          pattern += "(?:.*/)?";
          index += 3;
          continue;
        }
        pattern += ".*";
        index += 2;
        continue;
      }
      pattern += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      pattern += "[^/]";
      index += 1;
      continue;
    }
    if (character === "{") {
      const close = glob.indexOf("}", index);
      if (close !== -1) {
        const options = glob
          .slice(index + 1, close)
          .split(",")
          .map(escapeRegExp);
        pattern += `(?:${options.join("|")})`;
        index = close + 1;
        continue;
      }
    }
    pattern += escapeRegExp(character);
    index += 1;
  }
  return new RegExp(`${pattern}$`);
};

export const literalPrefix = (glob: string): string => {
  const literal: string[] = [];
  for (const segment of glob.split("/")) {
    if (/[*?{}[\]]/.test(segment)) break;
    literal.push(segment);
  }
  return literal.join("/");
};
