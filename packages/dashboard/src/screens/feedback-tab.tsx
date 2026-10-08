import { useState } from "react";
import { NoteCard } from "@/components/note-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotes } from "@/hooks/use-notes";
import { ticketHref } from "@/hooks/use-route";
import { NOTE_STATUSES, type Note, type NoteStatus } from "@/lib/types";

type Filter = NoteStatus | "all";

const FILTERS: Filter[] = ["all", ...NOTE_STATUSES];

const whereOf = (note: Note): string => {
  if (note.file) return `${note.file}${note.line === undefined ? "" : `:${note.line}`}`;
  return note.targetAgent ? `to ${note.targetAgent}` : "whole ticket";
};

export const FeedbackTab = ({ ticket }: { ticket: string }) => {
  const { notes } = useNotes(ticket);
  const [filter, setFilter] = useState<Filter>("all");
  const shown = notes.filter((note) => filter === "all" || note.status === filter).reverse();
  const count = (candidate: Filter): number =>
    notes.filter((note) => candidate === "all" || note.status === candidate).length;
  return (
    <Card className="min-h-0 gap-3 py-3">
      <div className="flex flex-wrap items-center gap-2 px-4">
        {FILTERS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={filter === candidate ? "default" : "outline"}
            onClick={() => setFilter(candidate)}
          >
            {candidate} <span className="font-mono text-xs">{count(candidate)}</span>
          </Button>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 px-4">
          {shown.length === 0 ? <p className="text-muted-foreground text-sm">No notes here.</p> : null}
          {shown.map((note) => (
            <div key={note.id} className="grid gap-1">
              <NoteCard note={note} where={whereOf(note)} />
              {note.file ? (
                <a
                  className="text-primary pl-1 text-xs hover:underline"
                  href={ticketHref(ticket, "files", { file: note.file })}
                >
                  Open the file
                </a>
              ) : null}
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
};
