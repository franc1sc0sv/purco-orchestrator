import { useState } from "react";
import { GateText } from "@/components/gate-text";
import { ToneBadge } from "@/components/state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { answerItem } from "@/lib/api";
import { TONES } from "@/lib/colors";
import { clock, shortFile } from "@/lib/format";
import type { OpenItem, PlanGatePayload } from "@/lib/types";
import { cn } from "@/lib/utils";

export const isPlanGate = (payload: unknown): payload is PlanGatePayload =>
  typeof payload === "object" &&
  payload !== null &&
  "type" in payload &&
  payload.type === "test-plan" &&
  "units" in payload &&
  Array.isArray(payload.units);

export const KIND_LABEL: Record<string, string> = {
  gate: "gate",
  sign: "signature",
  question: "question",
};

export const PlanGateBody = ({ payload }: { payload: PlanGatePayload }) => {
  const { radius } = payload;
  const resolved = radius.total - radius.unresolved;
  const resolvedPercent = radius.total === 0 ? 0 : Math.round((resolved / radius.total) * 100);
  const rows = payload.units.reduce((sum, unit) => sum + unit.rows, 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="font-mono uppercase">
          {payload.mode}
        </Badge>
        <Badge variant="secondary" className="font-mono uppercase">
          {payload.depth}
        </Badge>
        <Badge variant="secondary" className="font-mono uppercase">
          {payload.scope}
        </Badge>
        <span className="text-muted-foreground font-mono text-xs">
          run {payload.runId} / {payload.units.length} files / {rows} rows
        </span>
      </div>
      {payload.warnings.length > 0 ? (
        <Alert variant="destructive" className="gap-1 px-3 py-2">
          <AlertTitle>Check before you approve</AlertTitle>
          <AlertDescription className="grid gap-1">
            {payload.warnings.map((warning) => (
              <div key={warning.code} className="flex items-start gap-2">
                <Badge variant="destructive" className="shrink-0 font-mono">
                  {warning.code}
                </Badge>
                <span className="text-destructive/90 text-xs">{warning.message}</span>
              </div>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-1">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Radius resolved</span>
          <span className="font-mono">
            {resolved} of {radius.total}
          </span>
        </div>
        <Progress
          value={resolvedPercent}
          className={cn(radius.total > 0 && radius.unresolved / radius.total > 0.5 ? `${TONES.stuck.vars} ${TONES.stuck.bar}` : `${TONES.done.vars} ${TONES.done.bar}`)}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead className="text-right">Focus</TableHead>
            <TableHead>Level</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payload.units.map((unit) => (
            <TableRow key={unit.file}>
              <TableCell className="max-w-48 truncate font-mono text-xs" title={unit.file}>
                {shortFile(unit.file)}
              </TableCell>
              <TableCell className="text-right font-mono">{unit.rows}</TableCell>
              <TableCell className="text-right font-mono">{unit.focusLines.length || "none"}</TableCell>
              <TableCell>
                {unit.usecaseLevel ? (
                  <ToneBadge tone="done" dot={false}>
                    usecase
                  </ToneBadge>
                ) : (
                  <Badge variant="destructive">not usecase</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export const GateDialog = ({
  ticket,
  item,
  open,
  onOpenChange,
}: {
  ticket: string;
  item: OpenItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [note, setNote] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const sent = sentId === item.id;
  const isQuestion = item.kind === "question";
  const kind = KIND_LABEL[item.kind] ?? item.kind;

  const send = async (text: string): Promise<void> => {
    setFailed(false);
    const outcome = await answerItem(ticket, item.id, text);
    if (outcome === "failed") {
      setFailed(true);
      return;
    }
    setSentId(item.id);
    setNote("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[80vw] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ToneBadge tone="waiting" pulse>
              {kind}
            </ToneBadge>
            <DialogTitle>
              {ticket} / {kind} / {item.from}
            </DialogTitle>
            <span className="text-muted-foreground ml-auto font-mono text-xs">{clock(item.at)}</span>
          </div>
          <DialogDescription>
            {item.from} is waiting for your answer. The step does not go on until you answer.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="grid gap-4 p-4">
            {isPlanGate(item.payload) ? <PlanGateBody payload={item.payload} /> : null}
            <GateText text={item.text} />
          </div>
        </ScrollArea>
        {sent ? (
          <div className="text-muted-foreground text-sm">Answer sent. Waiting for the engine.</div>
        ) : (
          <div className="grid gap-2">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={isQuestion ? "Your answer" : "What must change"}
              className="min-h-20 resize-none"
              rows={3}
            />
            {failed ? <div className="text-xs">The answer was not saved. Try again.</div> : null}
            <div className="flex gap-2">
              {isQuestion ? (
                <Button disabled={note.trim().length === 0} onClick={() => void send(note.trim())}>
                  Answer
                </Button>
              ) : (
                <>
                  <Button onClick={() => void send("approve")}>Approve</Button>
                  <Button
                    variant="secondary"
                    disabled={note.trim().length === 0}
                    onClick={() => void send(note.trim())}
                  >
                    Request changes
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" className="border-destructive text-destructive ml-auto">
                        Stop
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Stop this step?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The engine ends the step here and reports it as escalated. You can resume the ticket later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep waiting</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void send("stop")}>Stop</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
