import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { clock } from "@/lib/format";
import type { Decision } from "@/lib/types";

const firstLine = (text: string): string => text.split("\n").find((line) => line.trim().length > 0) ?? "";

export const DecisionTimeline = ({ decisions }: { decisions: Decision[] }) => {
  if (decisions.length === 0) {
    return <div className="text-muted-foreground flex h-24 items-center justify-center text-sm">no decisions yet</div>;
  }
  return (
    <ScrollArea className="h-full">
      <ol className="border-border relative ml-2 grid gap-5 border-l pl-6">
        {decisions.map((decision) => (
          <li key={decision.id} className="relative">
            <span className="bg-chart-1 absolute top-1.5 -left-[1.9rem] size-2.5 rounded-full" />
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="font-mono">
                {decision.step}
              </Badge>
              <span className="text-muted-foreground font-mono">{clock(decision.at)}</span>
            </div>
            <div className="text-muted-foreground mt-1 truncate text-sm">{firstLine(decision.question)}</div>
            <div className="mt-0.5 text-sm font-medium">{firstLine(decision.decision || decision.text)}</div>
            <Collapsible className="mt-1">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="xs" className="text-muted-foreground">
                  brief
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="bg-muted mt-1 max-h-72 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                  {decision.brief}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
};
