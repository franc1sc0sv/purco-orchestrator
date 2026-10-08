import { CountStat } from "@/components/count-stat";
import { MutantPanel } from "@/components/mutant-panel";
import { Card } from "@/components/ui/card";
import { ticketHref } from "@/hooks/use-route";
import { isMutating } from "@/lib/agent-activity";
import { formatDuration, shortFile } from "@/lib/format";
import { buildCells, buildRows, buildStats, type CellState } from "@/lib/mutants";
import type { GateMark, TicketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const GATE_IDS = Array.from({ length: 10 }, (_, index) => `D${index + 1}`);

const CELL_STYLE: Record<CellState, string> = {
  killed: "bg-primary border-primary",
  survived: "bg-card border-primary border-2",
  equivalent:
    "border-blue-3 bg-[repeating-linear-gradient(45deg,var(--blue-3)_0_3px,transparent_3px_6px)]",
  running: "bg-blue-3 border-primary border-2 animate-soft-pulse",
  pending: "bg-muted border-transparent",
  error: "bg-card border-dashed border-muted-foreground",
};

const LEGEND: { state: CellState; label: string }[] = [
  { state: "killed", label: "killed" },
  { state: "survived", label: "survived" },
  { state: "equivalent", label: "equivalent" },
  { state: "running", label: "running now" },
  { state: "pending", label: "pending" },
];

const Square = ({ state, selected }: { state: CellState; selected: boolean }) => (
  <span
    className={cn(
      "block size-5 rounded-[5px] border",
      CELL_STYLE[state],
      selected && "ring-ring ring-2 ring-offset-2 ring-offset-background",
    )}
  />
);

const GateBar = ({ gates }: { gates: GateMark[] }) => (
  <Card className="shrink-0 gap-2 py-3">
    <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">Test gates · D1 to D10</h2>
    <div className="grid grid-cols-5 gap-2 px-4 md:grid-cols-10">
      {GATE_IDS.map((id) => {
        const mark = gates.find((gate) => gate.id === id);
        return (
          <div
            key={id}
            className={cn(
              "grid justify-items-center rounded-lg px-2 py-2",
              mark?.pass ? "bg-blue-1" : "bg-muted",
              mark && !mark.pass && "border-primary border",
            )}
          >
            <span className="text-muted-foreground text-xs">{id}</span>
            <span className="text-sm font-semibold">{mark ? (mark.pass ? "pass" : "fail") : "—"}</span>
          </div>
        );
      })}
    </div>
  </Card>
);

export const TestsTab = ({ detail, selected }: { detail: TicketDetail; selected: number | null }) => {
  const { ticket } = detail.summary;
  const cells = buildCells(detail.tests, isMutating(detail.events));
  const rows = buildRows(cells);
  const stats = buildStats(cells);
  const current = cells.find((cell) => cell.id === selected);
  return (
    <div className="flex size-full min-h-0 flex-col gap-3">
      <div className="flex justify-end gap-6">
        <CountStat value={`${stats.run} / ${stats.total}`} label="mutants run" />
        <CountStat value={stats.killed} label="killed" />
        <CountStat value={stats.survived} label="survived" />
        <CountStat value={stats.leftMs === null ? "—" : `~${formatDuration(stats.leftMs)}`} label="left at the average" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(380px,34%)] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <Card className="min-h-0 gap-2 py-3">
            <h2 className="text-muted-foreground px-4 text-xs font-semibold tracking-wider uppercase">
              Mutants by changed line · one square = one mutant
            </h2>
            {rows.length === 0 ? (
              <p className="text-muted-foreground px-4 text-sm">No mutants yet.</p>
            ) : (
              <div className="min-h-0 overflow-y-auto">
                <div className="grid gap-2 px-4">
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-center gap-4">
                      <span className="text-muted-foreground w-56 shrink-0 truncate font-mono text-xs" title={row.key}>
                        {shortFile(row.file)}:{row.line}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {row.cells.map((cell) => (
                          <a
                            key={cell.id}
                            href={ticketHref(ticket, "tests", { mutant: cell.id })}
                            title={`#${cell.id} ${cell.state}`}
                          >
                            <Square state={cell.state} selected={cell.id === selected} />
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-4 px-4">
              {LEGEND.map((item) => (
                <span key={item.state} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span className={cn("block size-3.5 rounded-[4px] border", CELL_STYLE[item.state])} />
                  {item.label}
                </span>
              ))}
            </div>
          </Card>
          <GateBar gates={detail.tests.gates} />
        </div>
        {current ? (
          <MutantPanel cell={current} closeHref={ticketHref(ticket, "tests")} />
        ) : (
          <Card className="text-muted-foreground items-center justify-center text-sm">Select a mutant to see it.</Card>
        )}
      </div>
    </div>
  );
};
