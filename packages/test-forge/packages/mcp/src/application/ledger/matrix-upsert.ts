import { all, openDb, run, tx } from "../../infrastructure/db/connection.ts";
import { requireRun } from "../../infrastructure/db/ledger-store.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import type { MatrixCellState } from "./ledger-input.ts";
import { MATRIX_CELL_STATES, requireEnum } from "./ledger-input.ts";

export type MatrixCellInput = {
  rowKey: string;
  columnKey: string;
  state: MatrixCellState;
  testRef?: string | undefined;
};

export type MatrixUpsertInput = {
  cwd: string;
  runId: number;
  matrixKey: string;
  rowKeys: readonly string[];
  columnKeys: readonly string[];
  cells?: readonly MatrixCellInput[] | undefined;
};

export type MatrixUpsertResult = {
  projectKey: string;
  runId: number;
  matrixKey: string;
  rowCount: number;
  columnCount: number;
  totalCells: number;
  emptyCells: number;
  states: Record<MatrixCellState | "waived", number>;
};

type StateCountRow = { state: string; total: number };

const requireDistinct = (
  keys: readonly string[],
  field: string,
): Set<string> => {
  if (keys.length === 0) {
    throw new Error(`${field} must name at least one key`);
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (key.trim().length === 0) {
      throw new Error(`${field} cannot hold a blank key`);
    }
    if (seen.has(key)) {
      throw new Error(`${field} repeats the key "${key}"`);
    }
    seen.add(key);
  }
  return seen;
};

const requirePlacedCell = (
  cell: MatrixCellInput,
  rows: ReadonlySet<string>,
  columns: ReadonlySet<string>,
): void => {
  requireEnum(cell.state, MATRIX_CELL_STATES, "state");
  if (!rows.has(cell.rowKey)) {
    throw new Error(`Cell row "${cell.rowKey}" is not one of the rowKeys`);
  }
  if (!columns.has(cell.columnKey)) {
    throw new Error(
      `Cell column "${cell.columnKey}" is not one of the columnKeys`,
    );
  }
  if (cell.state === "covered" && (cell.testRef ?? "").trim().length === 0) {
    throw new Error(
      `Cell ${cell.rowKey} by ${cell.columnKey} is covered but cites no test in testRef`,
    );
  }
};

export const matrixUpsert = async ({
  cwd,
  runId,
  matrixKey,
  rowKeys,
  columnKeys,
  cells,
}: MatrixUpsertInput): Promise<MatrixUpsertResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  requireRun(db, projectKey, runId);
  if (matrixKey.trim().length === 0) {
    throw new Error("A coverage matrix needs a matrixKey");
  }
  const rows = requireDistinct(rowKeys, "rowKeys");
  const columns = requireDistinct(columnKeys, "columnKeys");
  const written = cells ?? [];
  for (const cell of written) requirePlacedCell(cell, rows, columns);

  return tx(db, (txScope) => {
    for (const rowKey of rowKeys) {
      for (const columnKey of columnKeys) {
        run(
          txScope.db,
          `INSERT INTO coverage_cells (project_key, run_id, matrix_key, row_key, column_key)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (run_id, matrix_key, row_key, column_key) DO NOTHING`,
          [projectKey, runId, matrixKey, rowKey, columnKey],
        );
      }
    }

    for (const cell of written) {
      run(
        txScope.db,
        `UPDATE coverage_cells SET state = ?, test_ref = ?
         WHERE run_id = ? AND matrix_key = ? AND row_key = ? AND column_key = ?`,
        [
          cell.state,
          cell.testRef ?? null,
          runId,
          matrixKey,
          cell.rowKey,
          cell.columnKey,
        ],
      );
    }

    const counted = all<StateCountRow>(
      txScope.db,
      `SELECT state, COUNT(*) AS total FROM coverage_cells
       WHERE run_id = ? AND matrix_key = ? GROUP BY state`,
      [runId, matrixKey],
    );
    const countOf = (state: string): number =>
      counted.find((row) => row.state === state)?.total ?? 0;
    const states = {
      empty: countOf("empty"),
      covered: countOf("covered"),
      "not-applicable": countOf("not-applicable"),
      waived: countOf("waived"),
    };

    return {
      projectKey,
      runId,
      matrixKey,
      rowCount: rowKeys.length,
      columnCount: columnKeys.length,
      totalCells: counted.reduce((sum, row) => sum + row.total, 0),
      emptyCells: states.empty,
      states,
    };
  });
};
