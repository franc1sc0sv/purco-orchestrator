import { NOTE_STATUSES, type Note } from "@/lib/types";
import { clock } from "@/lib/format";
import { cn } from "@/lib/utils";

export const StatusChips = ({ status }: { status: Note["status"] }) => (
  <div className="flex gap-1.5">
    {NOTE_STATUSES.map((candidate) => (
      <span
        key={candidate}
        className={cn(
          "rounded-full border px-2 py-0.5 text-xs",
          candidate === status ? "bg-primary text-primary-foreground border-primary font-semibold" : "text-muted-foreground",
        )}
      >
        {candidate}
      </span>
    ))}
  </div>
);

export const noteLabel = (note: Note): string => `N-${note.id}`;

export const NoteCard = ({ note, where }: { note: Note; where: string }) => (
  <div className="bg-card grid gap-1.5 rounded-lg border px-3 py-2.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm">
        <span className="font-semibold">{note.via === "cli" ? "Claude session" : "You"}</span>{" "}
        <span className="text-muted-foreground text-xs">
          {noteLabel(note)} · {where} · {clock(note.createdAt)}
        </span>
      </span>
      <StatusChips status={note.status} />
    </div>
    <p className="text-sm whitespace-pre-wrap">{note.text}</p>
    {note.reply ? (
      <p className="border-primary border-l-2 pl-2 text-sm">
        <span className="font-semibold">Agent</span>{" "}
        <span className="text-muted-foreground text-xs">{note.appliedAt ? clock(note.appliedAt) : ""}</span> {note.reply}
      </p>
    ) : null}
  </div>
);
