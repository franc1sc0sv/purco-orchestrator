import { ToneBadge } from "@/components/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { clock, formatDuration } from "@/lib/format";
import { buildCells, type Cell } from "@/lib/mutants";
import type { ForgeJob, TestsView } from "@/lib/types";

const KILLED = new Set(["killed", "killed_by_timeout", "equivalent"]);

const Heading = ({ children }: { children: string }) => (
  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{children}</h3>
);

export const jobCells = (job: ForgeJob, tests: TestsView): Cell[] => {
  const cells = buildCells(tests, false);
  if (job.mutantIds) {
    const ids = new Set(job.mutantIds);
    return cells.filter((cell) => ids.has(cell.id));
  }
  return job.kind === "stryker" ? cells : [];
};

export const jobProgress = (job: ForgeJob, tests: TestsView, alive: boolean): string | undefined => {
  const cells = jobCells(job, tests);
  if (cells.length === 0) return undefined;
  if (job.mutantIds && job.state === "running" && alive) return `${cells.length} mutants in lanes`;
  const killed = cells.filter((cell) => KILLED.has(cell.state)).length;
  const tested = cells.filter((cell) => cell.result !== undefined).length;
  return `tested ${tested} of ${cells.length}, killed ${killed}, open ${tested - killed}`;
};

const MutantRow = ({ cell }: { cell: Cell }) => (
  <div className="overflow-hidden rounded-lg border font-mono text-xs">
    <div className="bg-muted text-muted-foreground flex items-center gap-2 px-3 py-1.5">
      <span className="text-foreground font-semibold">#{cell.id}</span>
      <span className="min-w-0 flex-1 truncate" title={cell.file}>
        {cell.file.split("/").pop()}:{cell.line}
      </span>
      {cell.detail.mutator ? <span>{cell.detail.mutator}</span> : null}
      <Badge variant={KILLED.has(cell.state) ? "secondary" : "outline"}>{cell.state}</Badge>
    </div>
    <div className="text-muted-foreground px-3 py-1 whitespace-pre-wrap break-all line-through">{cell.detail.before}</div>
    <div className="bg-blue-1 text-primary px-3 py-1 whitespace-pre-wrap break-all">{cell.detail.after}</div>
  </div>
);

export const JobPanel = ({
  job,
  tests,
  alive,
  now,
  closeHref,
}: {
  job: ForgeJob;
  tests: TestsView;
  alive: boolean;
  now: number;
  closeHref: string;
}) => {
  const cells = jobCells(job, tests);
  const shown = job.mutantIds ? cells : cells.filter((cell) => !KILLED.has(cell.state));
  const running = job.state === "running" && alive;
  const elapsedMs = (job.endedAt ? Date.parse(job.endedAt) : now) - Date.parse(job.startedAt);
  const progress = jobProgress(job, tests, alive);
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-lg font-semibold">{job.label}</h2>
        <Badge variant="secondary" className="font-mono">
          {job.kind}
        </Badge>
        <ToneBadge tone={running ? "running" : job.state === "failed" ? "failed" : "done"} pulse={running}>
          {running ? "running" : job.state}
        </ToneBadge>
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <a href={closeHref}>Close</a>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-5 p-4">
          <div className="grid grid-cols-3 gap-3 font-mono text-sm">
            <div>
              <Heading>Workers</Heading>
              {job.workers > 0 ? job.workers : "-"}
            </div>
            <div>
              <Heading>Time</Heading>
              {formatDuration(elapsedMs)}
            </div>
            <div>
              <Heading>Started</Heading>
              {clock(job.startedAt)}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Heading>What runs</Heading>
            <p className="text-sm">{job.command ?? job.detail}</p>
            <p className="text-muted-foreground text-xs">{job.detail}</p>
          </div>
          {progress ? (
            <div className="grid gap-1.5">
              <Heading>Progress</Heading>
              <p className="font-mono text-sm">{progress}</p>
            </div>
          ) : null}
          {shown.length > 0 ? (
            <div className="grid gap-2">
              <Heading>{job.mutantIds ? `Mutants (${shown.length})` : `Open mutants (${shown.length})`}</Heading>
              {shown.map((cell) => (
                <MutantRow key={cell.id} cell={cell} />
              ))}
            </div>
          ) : null}
          {job.testFiles && job.testFiles.length > 0 ? (
            <div className="grid gap-1.5">
              <Heading>{`Test files (${job.testFiles.length})`}</Heading>
              {job.testFiles.map((file) => (
                <span key={file} className="bg-muted rounded-md px-2 py-1 font-mono text-xs break-all">
                  {file}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </Card>
  );
};
