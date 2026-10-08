import type { MutantEvent, PlannedMutant, TestsView } from "@/lib/types";

export type CellState = "killed" | "survived" | "equivalent" | "running" | "pending" | "error";

export type Cell = {
  id: number;
  file: string;
  line: number;
  state: CellState;
  detail: PlannedMutant;
  result: MutantEvent | undefined;
};

export type MutantRow = { key: string; file: string; line: number; cells: Cell[] };

export type MutantStats = {
  run: number;
  total: number;
  killed: number;
  survived: number;
  leftMs: number | null;
};

export const buildCells = (tests: TestsView, mutating: boolean): Cell[] => {
  const results = new Map(tests.mutants.map((mutant) => [mutant.id, mutant]));
  const planned = new Map(tests.planned.map((mutant) => [mutant.id, mutant]));
  const ids = [...new Set([...planned.keys(), ...results.keys()])].sort((a, b) => a - b);
  const runningId = mutating ? ids.find((id) => !results.has(id)) : undefined;
  return ids.map((id) => {
    const result = results.get(id);
    const detail = planned.get(id) ?? (result ? { id, file: result.file, line: result.line, before: result.before, after: result.after } : undefined);
    const state: CellState = result ? result.status : id === runningId ? "running" : "pending";
    return {
      id,
      file: detail?.file ?? "",
      line: detail?.line ?? 0,
      state,
      detail: detail ?? { id, file: "", line: 0, before: "", after: "" },
      result,
    };
  });
};

export const buildRows = (cells: Cell[]): MutantRow[] => {
  const rows = new Map<string, MutantRow>();
  for (const cell of cells) {
    const key = `${cell.file}:${cell.line}`;
    const row = rows.get(key) ?? { key, file: cell.file, line: cell.line, cells: [] };
    row.cells.push(cell);
    rows.set(key, row);
  }
  return [...rows.values()];
};

export const buildStats = (cells: Cell[]): MutantStats => {
  const done = cells.filter((cell) => cell.result !== undefined);
  const timed = done.filter((cell) => (cell.result?.ms ?? 0) > 0);
  const average = timed.length === 0 ? null : timed.reduce((sum, cell) => sum + (cell.result?.ms ?? 0), 0) / timed.length;
  return {
    run: done.length,
    total: cells.length,
    killed: cells.filter((cell) => cell.state === "killed").length,
    survived: cells.filter((cell) => cell.state === "survived").length,
    leftMs: average === null ? null : average * (cells.length - done.length),
  };
};
