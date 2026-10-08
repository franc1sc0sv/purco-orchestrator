import { readTextFile } from "./files.ts";
import type { Logger } from "@stryker-mutator/api/logging";
import { Instrumenter } from "@stryker-mutator/instrumenter";
import { join } from "node:path";
import type { MutantSite } from "test-forge-contracts/stryker";

const silentLogger: Logger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
};

const INSTRUMENTER_OPTIONS = {
  ignorers: [],
  excludedMutations: [],
  plugins: null,
};

export type InstrumentedFile = {
  file: string;
  sites: MutantSite[];
  error: string | null;
};

const instrumentOne = async (
  instrumenter: Instrumenter,
  root: string,
  file: string,
): Promise<InstrumentedFile> => {
  const content = readTextFile(join(root, file));
  if (content === null) {
    return { file, sites: [], error: `cannot read ${file}` };
  }
  try {
    const result = await instrumenter.instrument(
      [{ name: file, content, mutate: true }],
      INSTRUMENTER_OPTIONS,
    );
    const sites = result.mutants.map((mutant) => ({
      file,
      mutator: mutant.mutatorName,
      replacement: mutant.replacement,
      start: {
        line: mutant.location.start.line + 1,
        column: mutant.location.start.column + 1,
      },
      end: {
        line: mutant.location.end.line + 1,
        column: mutant.location.end.column + 1,
      },
    }));
    return { file, sites, error: null };
  } catch (error) {
    return {
      file,
      sites: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const listMutantSites = async (
  root: string,
  files: readonly string[],
): Promise<InstrumentedFile[]> => {
  const instrumenter = new Instrumenter(silentLogger);
  const listed: InstrumentedFile[] = [];
  for (const file of files) {
    listed.push(await instrumentOne(instrumenter, root, file));
  }
  return listed;
};
