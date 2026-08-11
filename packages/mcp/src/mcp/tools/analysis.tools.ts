import { astCheckBatch } from "../../application/analysis/check-batch.ts";
import { astCheck } from "../../application/analysis/check.ts";
import type { CheckInput } from "../../application/analysis/check.ts";
import { astCorpusHash } from "../../application/analysis/corpus-hash.ts";
import { astFileFacts } from "../../application/analysis/file-facts.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor, pageInput } from "../page.ts";
import { respond } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_PAGE_LIMIT } from "test-forge-contracts/listing";
import { z } from "zod";

const checkEntry = z
  .object({
    checkId: z
      .string()
      .describe(
        "Identifier echoed back on the outcome. Defaults to check-<position>."
      )
      .optional(),
    check: z
      .string()
      .describe(
        "The expression to evaluate, written as 'ast:<expression>' or 'grep:<pattern>'."
      ),
    appliesWhen: z
      .string()
      .describe(
        "Guard expression in the same form. The check is skipped, not violated, when it is false."
      )
      .optional(),
  })
  .strict();

type CheckEntry = z.infer<typeof checkEntry>;

const astCheckInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    filePath: z
      .string()
      .describe("File to check, absolute or relative to cwd."),
    checks: z
      .array(z.union([z.string(), checkEntry]))
      .describe(
        "Checks to evaluate. Each entry is either a bare check string or an object with checkId, check and appliesWhen."
      ),
  })
  .strict();

const astCheckBatchInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    filePaths: z
      .array(z.string())
      .min(1)
      .describe(
        "Every file to check, absolute or relative to cwd. A whole corpus belongs in one call."
      ),
    checks: z
      .array(z.union([z.string(), checkEntry]))
      .describe(
        "Checks to evaluate against every file. Each entry is either a bare check string or an object with checkId, check and appliesWhen."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const astFileFactsInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    filePath: z
      .string()
      .describe("File to analyse, absolute or relative to cwd."),
  })
  .strict();

const astCorpusHashInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    globs: z
      .array(z.string())
      .describe(
        "Glob patterns relative to cwd, for example 'tests/**/*.test.ts'."
      ),
    includeFiles: z
      .boolean()
      .describe(
        "Inline the first page of the per-file list beside its summary. The summary and the handle come back either way."
      )
      .default(false),
    page: pageInput.optional(),
  })
  .strict();

const toCheckInput = (entry: string | CheckEntry): CheckInput =>
  typeof entry === "string"
    ? entry
    : {
        check: entry.check,
        ...(entry.checkId === undefined ? {} : { checkId: entry.checkId }),
        ...(entry.appliesWhen === undefined
          ? {}
          : { appliesWhen: entry.appliesWhen }),
      };

export const registerAnalysisTools = (server: McpServer): void => {
  server.registerTool(
    "ast_check",
    {
      title: "Run mechanical rule checks over one file",
      description: [
        "Evaluates 'ast:<expression>' and 'grep:<pattern>' checks against a single file and reports, per check, whether it applied, whether it was violated, and the exact sites that prove it.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- filePath (string): file to check, absolute or relative to cwd.",
        "- checks (array of string or object): each entry is a check string, or { checkId?: string, check: string, appliesWhen?: string }.",
        "",
        "Returns: { filePath: string, fileHash: string, appliedCount: number, violatedCount: number, erroredCount: number, checks: Array<{ checkId: string, kind: 'ast' | 'grep' | null, expression: string | null, evaluable: boolean, applied: boolean, violated: boolean, sites: Array<{ line: number, quote: string }>, siteCount: number, sitesTruncated: boolean, error: string | null }> }. sites carries at most 50 entries; siteCount is how many the check really found and sitesTruncated says the list is cut.",
        "",
        'helperBody(name, predicate) follows an imported helper one level into the file that defines it and evaluates predicate, written as a string, against that definition alone: helperBody("anchorDenverClock", "calls(/useFakeTimers/)") sees a clock frozen inside the helper, which no regex over the test file can see. Name the helper or use a narrow wildcard such as "*Clock"; when a matching import cannot be followed - a package under node_modules, a module that resolves to no file, a definition that is not there - the check comes back evaluable false with the reason, never a silent false.',
        "",
        "Examples:",
        "- Use it to decide whether one test file breaks a codex rule before writing a verdict.",
        "- Use it to prove a violation with line and quote instead of asserting one from memory.",
        "- Do NOT use it once per file over a corpus: that is one model turn per file. Call ast_check_batch with every file in one call.",
        "- Do NOT use it to learn what a file contains before you have a rule to test: call ast_file_facts instead.",
        "- Do NOT use it to tell whether a whole corpus changed: call ast_corpus_hash instead.",
        "",
        "Error handling: an unreadable file fails the call with the resolved path. A check whose expression cannot be parsed is not an error for the call; that check comes back with evaluable false and the parser message in its error field, and the other checks still report.",
      ].join("\n"),
      inputSchema: astCheckInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, filePath, checks }) =>
      respond(
        "Send fewer entries in checks, or check one filePath at a time.",
        () => astCheck({ cwd, filePath, checks: checks.map(toCheckInput) })
      )
  );

  server.registerTool(
    "ast_check_batch",
    {
      title: "Run mechanical rule checks over many files",
      description: [
        "Evaluates the same checks against every file in one call and answers with a summary instead of one report per file: how many files each check applied to, how many it flagged, how many it could not read, and which files carry a violation. A file that cannot be read is reported without stopping the rest.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- filePaths (string[]): every file to check. A whole corpus belongs in one call.",
        "- checks (array of string or object): the checks to evaluate against every file.",
        "- page (object, optional): { list: 'reports' | 'violations' | 'failures', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, readCount, failedCount, filesWithViolation, byCheck: Array<{ checkId, appliedFiles, violatedFiles, erroredFiles }>, reports: ListView, violations: ListView, failures: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every per-file report with its sites.",
        "",
        "Examples:",
        "- Use it to run one rule over a whole corpus, in one call, and read byCheck to see whether the rule is dead or hot.",
        "- Use violations.sample to see which files are flagged before opening any report.",
        "- Do NOT loop ast_check over a file list; one call per file costs a model turn per file.",
        "- Do NOT use it to tell whether a corpus changed: call ast_corpus_hash.",
        "",
        "Truncation: the summary is bounded whatever the corpus size, and the per-file sites live in the handle file rather than in the reply. A page is capped at 100 items.",
        "",
        "Error handling: an unreadable file lands in failures with the resolved path and the rest still report. A check whose expression cannot be parsed is not an error for the call; it comes back with evaluable false in every file's report and counts in that check's erroredFiles.",
      ].join("\n"),
      inputSchema: astCheckBatchInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, filePaths, checks, page }) =>
      respond(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        () => {
          const batch = astCheckBatch({
            cwd,
            filePaths,
            checks: checks.map(toCheckInput),
          });
          return {
            requested: batch.requested,
            readCount: batch.readCount,
            failedCount: batch.failedCount,
            filesWithViolation: batch.filesWithViolation,
            byCheck: batch.byCheck,
            reports: listView({
              kind: "ast-check-reports",
              items: batch.reports,
              label: (report) =>
                `${report.filePath}: applied ${report.appliedCount}, violated ${report.violatedCount}`,
              group: (report) =>
                report.violatedCount > 0 ? "violated" : "clean",
              page: pageFor("reports", page),
            }),
            violations: listView({
              kind: "ast-check-violations",
              items: batch.violations,
              label: (report) =>
                `${report.filePath}: violated ${report.violatedCount}`,
              page: pageFor("violations", page),
            }),
            failures: listView({
              kind: "ast-check-failures",
              items: batch.failures,
              label: (failure) => `${failure.ref}: ${failure.error}`,
              page: pageFor("failures", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "ast_file_facts",
    {
      title: "Structural signals for one file",
      description: [
        "Reads one file and returns its structural signals: imports, harness utilities, assertion shapes, isolation hooks, time control, mock usage, test titles, describe nesting, JSX elements and a call tally.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- filePath (string): file to analyse, absolute or relative to cwd.",
        "",
        "Returns: { filePath: string, fileHash: string, lineCount: number, byteLength: number, imports: ImportFact[], harnessUtilities: HarnessUtility[], assertions: { total, shapes, wholeObject, negated, snapshot }, isolation: { hooks, signals, factories }, timeControl: { controlled, signals, dateConstructionCount }, mocks: { used, signals }, tests: TestFact[], describes: DescribeFact[], maxDescribeDepth: number, testCount: number, focusedOrSkipped: DeclarationSite[], jsxElements: Tally[], callTally: Tally[] }.",
        "",
        "Examples:",
        "- Use it to learn the house harness of a test file before writing a sibling test.",
        "- Use it to count assertion shapes when a rule is about how a suite asserts.",
        "- Do NOT use it to evaluate a rule: call ast_check, which reports applied and violated per rule.",
        "- Do NOT call it file by file over a whole corpus to detect drift: call ast_corpus_hash with the globs.",
        "",
        "Truncation: a large or heavily nested file can exceed the 25000 character limit. The text is then cut and closes with a TRUNCATED notice, and the structured content reports the true size. Narrow the result by passing a single, smaller filePath.",
        "",
        "Error handling: an unreadable file fails the call with the resolved path.",
      ].join("\n"),
      inputSchema: astFileFactsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, filePath }) =>
      respond(
        "Pass a single, smaller filePath: this tool reports one file at a time and cannot sample.",
        () => astFileFacts({ cwd, filePath })
      )
  );

  server.registerTool(
    "ast_corpus_hash",
    {
      title: "Stable hash over a set of files",
      description: [
        "Walks every file matched by the globs, hashes each one, and folds the sorted list into a single hash so an aspect can tell whether its corpus is stale.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- globs (string[]): glob patterns relative to cwd.",
        "- includeFiles (boolean, default false): inline the first page of the per-file list.",
        "- page (object, optional): { offset, limit } opens a window of the per-file list.",
        "",
        "Returns: { hash: string, fileCount: number, totalLines: number, globs: string[], files: ListView }. The ListView carries { total, sample, handle, page?, items? } and its handle path is a JSON file holding every file with its hash and line count, which is the file list to hand to ast_check_batch.",
        "",
        "Examples:",
        "- Use it to decide whether a frozen codex still matches the corpus it was learned from.",
        "- Use it before a doctrine session to prove the corpus moved since the last run.",
        "- Use the files handle as the corpus list for ast_check_batch instead of inlining every path.",
        "- Do NOT use it to find which file changed inside the corpus: compare the fileHash from ast_file_facts per candidate.",
        "- Do NOT use it to evaluate rules over the corpus: call ast_check_batch with the file list.",
        "",
        "Truncation: the file list comes back as a bounded summary, so a large corpus no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a glob that matches nothing is not an error; it returns fileCount 0 and the hash of the empty list. An unreadable matched file is kept with hash 'unreadable' so the fold stays stable.",
      ].join("\n"),
      inputSchema: astCorpusHashInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, globs, includeFiles, page }) =>
      respond(
        "Ask for a narrower page, and read the handle file for the whole corpus list.",
        () => {
          const report = astCorpusHash({ cwd, globs, includeFiles: true });
          const { files, ...rest } = report;
          return {
            ...rest,
            files: listView({
              kind: "corpus-files",
              items: files ?? [],
              label: (file) => `${file.path} (${file.lineCount} lines)`,
              page:
                page ??
                (includeFiles
                  ? { offset: 0, limit: MAX_PAGE_LIMIT }
                  : undefined),
            }),
          };
        }
      )
  );
};
