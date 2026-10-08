import { isTestFile } from "../../domain/stryker/diff.ts";
import { reachingFiles } from "../../domain/stryker/import-graph.ts";
import { reverseImportGraph } from "../../infrastructure/stryker-imports.ts";

export const relatedTestFiles = async (
  root: string,
  changedFiles: readonly string[],
  changedTests: readonly string[],
  hubImporterLimit?: number,
): Promise<string[]> => {
  const graph = await reverseImportGraph(root);
  const reaching = [...reachingFiles(changedFiles, graph, hubImporterLimit)].filter(isTestFile);
  return [...new Set([...changedTests, ...reaching])].sort();
};
