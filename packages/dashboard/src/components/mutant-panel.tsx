import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/format";
import type { Cell } from "@/lib/mutants";

const Heading = ({ children }: { children: string }) => (
  <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{children}</h3>
);

export const MutantPanel = ({ cell, closeHref }: { cell: Cell; closeHref: string }) => {
  const { detail, result } = cell;
  return (
    <Card className="min-h-0 gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h2 className="text-lg font-semibold">
          Mutant #{cell.id} · {cell.state}
        </h2>
        <Badge variant="secondary" className="font-mono">
          line {detail.line}
        </Badge>
        {detail.mutator ? (
          <Badge variant="outline" className="font-mono">
            {detail.mutator}
          </Badge>
        ) : null}
        {result ? (
          <Badge variant="outline" className="font-mono">
            {formatDuration(result.ms)}
          </Badge>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="ml-auto">
          <a href={closeHref}>Close</a>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-5 p-4">
          <div className="overflow-hidden rounded-lg border font-mono text-xs">
            <div className="bg-muted text-muted-foreground px-3 py-1.5 break-all">{detail.file}</div>
            <div className="text-muted-foreground flex gap-3 px-3 py-1.5 line-through">
              <span>{detail.line}</span>
              <span className="whitespace-pre-wrap break-all">{detail.before}</span>
            </div>
            <div className="bg-blue-1 text-primary flex gap-3 px-3 py-1.5">
              <span>{detail.line}</span>
              <span className="whitespace-pre-wrap break-all">{detail.after}</span>
            </div>
          </div>
          <div className="grid gap-2">
            <Heading>Tests that ran against it</Heading>
            {result?.tests && result.tests.length > 0 ? (
              <div className="grid gap-1.5">
                {result.tests.map((test) => (
                  <span key={test} className="bg-muted rounded-md px-2 py-1 font-mono text-xs break-all">
                    {test}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {result ? "No test is recorded for this mutant." : "Not run yet."}
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </Card>
  );
};
