import { useState } from "react";
import { NoteCard } from "@/components/note-card";
import { NoteComposer } from "@/components/note-composer";
import type { DiffRow } from "@/lib/diff";
import type { Note } from "@/lib/types";
import { cn } from "@/lib/utils";

const ROW_STYLE: Record<DiffRow["kind"], string> = {
  hunk: "bg-muted text-muted-foreground",
  context: "",
  add: "bg-primary/15",
  remove: "bg-muted/60 text-muted-foreground line-through",
};

const MARKER: Record<DiffRow["kind"], string> = { hunk: "", context: "", add: "+", remove: "−" };

export const DiffView = ({
  rows,
  notes,
  onNote,
}: {
  rows: DiffRow[];
  notes: Note[];
  onNote: (line: number, text: string) => Promise<boolean>;
}) => {
  const [composing, setComposing] = useState<number | null>(null);
  return (
    <div className="font-mono text-sm">
      {rows.map((row, index) => {
        const line = row.newNo;
        const threads = line === null ? [] : notes.filter((note) => note.line === line);
        return (
          <div key={`${index}-${row.oldNo}-${row.newNo}`}>
            <div className={cn("flex items-baseline", ROW_STYLE[row.kind])}>
              <span className="text-muted-foreground w-10 shrink-0 pr-2 text-right text-xs select-none">
                {row.kind === "remove" ? row.oldNo : ""}
              </span>
              {line === null ? (
                <span className="w-10 shrink-0" />
              ) : (
                <button
                  type="button"
                  title="Leave a note on this line"
                  className="text-muted-foreground hover:text-primary hover:bg-primary/10 w-10 shrink-0 cursor-pointer pr-2 text-right text-xs"
                  onClick={() => setComposing(composing === line ? null : line)}
                >
                  {line}
                </button>
              )}
              <span className="text-primary w-4 shrink-0 text-center select-none">{MARKER[row.kind]}</span>
              <span className="min-w-0 flex-1 py-0.5 pr-3 break-all whitespace-pre-wrap">
                {row.kind === "hunk" ? row.text : row.text || " "}
              </span>
            </div>
            {threads.length > 0 || composing === line ? (
              <div className="grid gap-2 py-2 pr-3 pl-16 font-sans">
                {threads.map((note) => (
                  <NoteCard key={note.id} note={note} where={`on line ${note.line}`} />
                ))}
                {composing === line && line !== null ? (
                  <NoteComposer
                    placeholder={`Note on line ${line}…`}
                    onCancel={() => setComposing(null)}
                    onSend={async (text) => {
                      const ok = await onNote(line, text);
                      if (ok) setComposing(null);
                      return ok;
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
