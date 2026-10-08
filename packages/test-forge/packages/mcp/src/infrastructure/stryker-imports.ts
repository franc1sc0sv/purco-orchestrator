import {
  addImports,
  importsOf,
  parseResolverConfig,
} from "../domain/stryker/import-graph.ts";
import type { ReverseImportGraph } from "../domain/stryker/import-graph.ts";
import { readTextFile } from "./files.ts";
import { listedFiles } from "./git.ts";
import { join } from "node:path";

const SOURCE_PATTERNS = ["*.ts", "*.tsx"];

export const reverseImportGraph = async (
  root: string,
): Promise<ReverseImportGraph> => {
  const files = await listedFiles(root, SOURCE_PATTERNS);
  const known = new Set(files);
  const config = parseResolverConfig(readTextFile(join(root, "tsconfig.json")));
  const graph: ReverseImportGraph = new Map();
  for (const file of files) {
    const text = readTextFile(join(root, file));
    if (text !== null) addImports(graph, file, importsOf(file, text, config, known));
  }
  return graph;
};
