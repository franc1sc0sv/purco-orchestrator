import path from "node:path";
import { formatOutcome, scoreRun } from "./eval.ts";

const usage = `usage: purco-eval --db <file> --run <id> --labels <file>\n`;

const args: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index];
  if (token?.startsWith("--")) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} needs a value\n\n${usage}`);
    args[token.slice(2)] = value;
    index += 1;
  }
}
if (!args.db || !args.run || !args.labels) throw new Error(usage);

process.stdout.write(
  `${formatOutcome(scoreRun(path.resolve(args.db), args.run, path.resolve(args.labels)))}\n`,
);
