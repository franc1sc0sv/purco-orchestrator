import { signalsOf } from "../../domain/analysis/signals.ts";
import { scanSource } from "../../domain/analysis/source-facts.ts";
import {
  absolutePath,
  hashText,
  readTextFile,
} from "../../infrastructure/files.ts";
import { relative } from "node:path";
import type { FileFactsReport } from "test-forge-contracts/analysis";

export type AstFileFactsOptions = {
  cwd: string;
  filePath: string;
};

export const astFileFacts = ({
  cwd,
  filePath,
}: AstFileFactsOptions): FileFactsReport => {
  const absolute = absolutePath(cwd, filePath);
  const source = readTextFile(absolute);
  if (source === null) {
    throw new Error(`cannot read the file to analyse: ${absolute}`);
  }

  const { lineCount, ...signals } = signalsOf(scanSource(source));

  return {
    filePath: relative(cwd, absolute),
    fileHash: hashText(source),
    lineCount,
    byteLength: Buffer.byteLength(source),
    ...signals,
  };
};
