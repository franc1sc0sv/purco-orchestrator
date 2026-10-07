import path from "node:path";

const TEST_PATH = new RegExp(
  String.raw`[.\-_](test|spec)\.[cm]?[jt]sx?$|(^|/)(tests?|__tests__|e2e|fixtures)/`,
  "i",
);

const WRITING_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

export const isTestPath = (file: string): boolean => TEST_PATH.test(file);

const runsGit = (command: string): boolean =>
  command
    .split(/[;&|]+|\$\(|`/)
    .some((segment) => /^(\S*\/)?git$/.test(segment.trim().split(/\s+/)[0] ?? ""));

export const testWriteRefusal = (
  tool: string,
  input: Record<string, unknown>,
  root: string,
): string | undefined => {
  if (tool === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    return runsGit(command) ? "A test author never runs git." : undefined;
  }
  if (!WRITING_TOOLS.has(tool)) return undefined;
  const target = String(input.file_path ?? input.notebook_path ?? "");
  if (target.length === 0 || isTestPath(path.resolve(root, target))) return undefined;
  return `A test author writes test files only. "${target}" is production code: report the defect in your handoff instead.`;
};
