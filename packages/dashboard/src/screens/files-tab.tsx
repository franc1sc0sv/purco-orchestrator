import { DiffView } from "@/components/diff-view";
import { NoteCard } from "@/components/note-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFileDiff, useFiles } from "@/hooks/use-files";
import { useNotes } from "@/hooks/use-notes";
import { ticketHref } from "@/hooks/use-route";
import { postNote } from "@/lib/api";
import { baseOf, folderOf, parseDiff } from "@/lib/diff";
import { clock } from "@/lib/format";
import type { FileEntry, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAR_CELLS = 6;

const ChangeBar = ({ added, removed }: { added: number; removed: number }) => {
  const total = Math.max(1, added + removed);
  const dark = added === 0 ? 0 : Math.max(1, Math.round((added / total) * BAR_CELLS));
  return (
    <span className="flex shrink-0 gap-px" title={`+${added} −${removed}`}>
      {Array.from({ length: BAR_CELLS }, (_, cell) => (
        <span key={cell} className={cn("h-3.5 w-1", cell < dark ? "bg-primary" : "bg-primary/25")} />
      ))}
    </span>
  );
};

const groupByFolder = (files: FileEntry[]): [string, FileEntry[]][] => {
  const groups = new Map<string, FileEntry[]>();
  for (const file of files) groups.set(folderOf(file.path), [...(groups.get(folderOf(file.path)) ?? []), file]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
};

const FileRow = ({
  ticket,
  file,
  selected,
  noteCount,
}: {
  ticket: string;
  file: FileEntry;
  selected: boolean;
  noteCount: number;
}) => (
  <a
    href={ticketHref(ticket, "files", { file: file.path })}
    className={cn("hover:bg-muted flex items-center gap-2 rounded-lg px-2.5 py-1.5", selected && "bg-primary/15")}
  >
    <span className="grid min-w-0 flex-1">
      <span className="truncate font-mono text-sm" title={file.path}>
        {baseOf(file.path)}
      </span>
      <span className="text-muted-foreground truncate text-xs">{file.agent ?? "not written in this run"}</span>
    </span>
    {noteCount > 0 ? (
      <Badge className="shrink-0">
        {noteCount} {noteCount === 1 ? "note" : "notes"}
      </Badge>
    ) : null}
    <ChangeBar added={file.added} removed={file.removed} />
  </a>
);

const FileTree = ({
  ticket,
  files,
  selected,
  notes,
}: {
  ticket: string;
  files: FileEntry[];
  selected: string | null;
  notes: Note[];
}) => (
  <Card className="min-h-0 gap-2 py-3">
    <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">Changed files</h2>
    <ScrollArea className="min-h-0 flex-1">
      <div className="grid gap-3 px-2">
        {groupByFolder(files).map(([folder, group]) => (
          <div key={folder} className="grid gap-0.5">
            <span className="text-muted-foreground px-2.5 font-mono text-xs">{folder || "/"}</span>
            {group.map((file) => (
              <FileRow
                key={file.path}
                ticket={ticket}
                file={file}
                selected={file.path === selected}
                noteCount={notes.filter((note) => note.file === file.path).length}
              />
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
    <p className="text-muted-foreground px-4 text-xs">Bars: dark = added, light = removed</p>
  </Card>
);

const FileDetail = ({ ticket, file, notes, reload }: { ticket: string; file: FileEntry; notes: Note[]; reload: () => void }) => {
  const diff = useFileDiff(ticket, file.path, file.version);
  const own = notes.filter((note) => note.file === file.path);
  const fileLevel = own.filter((note) => note.line === undefined);
  const send = async (text: string, line?: number): Promise<boolean> => {
    const ok = await postNote(ticket, { text, file: file.path, line });
    if (ok) reload();
    return ok;
  };
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="font-mono text-base font-semibold">{baseOf(file.path)}</h2>
        {file.agent ? (
          <Badge variant="secondary">
            written by {file.agent}
            {file.at ? ` · ${clock(file.at)}` : ""}
          </Badge>
        ) : null}
        <Badge variant="outline">version {file.version}</Badge>
        <span className="text-muted-foreground ml-auto font-mono text-xs">
          +{file.added} −{file.removed}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {fileLevel.length > 0 ? (
          <div className="grid gap-2 border-b p-3">
            {fileLevel.map((note) => (
              <NoteCard key={note.id} note={note} where="on the file" />
            ))}
          </div>
        ) : null}
        {diff === undefined ? <p className="text-muted-foreground p-4 text-sm">Loading the diff…</p> : null}
        {diff === null ? <p className="text-muted-foreground p-4 text-sm">The diff is not available.</p> : null}
        {diff ? (
          <DiffView rows={parseDiff(diff.diff)} notes={own} onNote={(line, text) => send(text, line)} />
        ) : null}
        <p className="text-muted-foreground px-4 py-3 text-sm">Click a line number to leave a note…</p>
      </ScrollArea>
    </Card>
  );
};

export const FilesTab = ({ ticket, selected }: { ticket: string; selected: string | null }) => {
  const view = useFiles(ticket);
  const { notes, reload } = useNotes(ticket);
  if (view === undefined) return <p className="text-muted-foreground p-4 text-sm">Loading the files…</p>;
  if (view.files.length === 0) {
    return <p className="text-muted-foreground p-4 text-sm">No file has changed in the worktree yet.</p>;
  }
  const file = view.files.find((candidate) => candidate.path === selected);
  return (
    <div className="grid min-h-0 grid-cols-[minmax(300px,24%)_minmax(0,1fr)] gap-3">
      <FileTree ticket={ticket} files={view.files} selected={selected} notes={notes} />
      {file ? (
        <FileDetail ticket={ticket} file={file} notes={notes} reload={reload} />
      ) : (
        <Card className="text-muted-foreground items-center justify-center text-sm">Select a file to see its diff.</Card>
      )}
    </div>
  );
};
