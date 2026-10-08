export type DiffRow = {
  kind: "hunk" | "context" | "add" | "remove";
  oldNo: number | null;
  newNo: number | null;
  text: string;
};

const HUNK = new RegExp("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@");

export const parseDiff = (diff: string): DiffRow[] => {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", oldNo: null, newNo: null, text: line });
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") rows.push({ kind: "add", oldNo: null, newNo: newNo++, text });
    else if (marker === "-") rows.push({ kind: "remove", oldNo: oldNo++, newNo: null, text });
    else if (marker === " ") rows.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
  }
  return rows;
};

export const folderOf = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
};

export const baseOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
