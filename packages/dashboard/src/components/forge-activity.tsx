import { ToneBadge } from "@/components/state-badge";
import { Card } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";
import { buildCells, buildStats } from "@/lib/mutants";
import type { PipelineStage, TestsView } from "@/lib/types";

export const isTesting = (pipeline: PipelineStage[]): boolean =>
  pipeline.some((stage) => stage.stage === "testing" && stage.steps.some((step) => step.status === "running"));

const Count = ({ label, value }: { label: string; value: number }) => (
  <span className="text-muted-foreground font-mono text-xs">
    {label} <span className="text-foreground font-semibold">{value}</span>
  </span>
);

export const ForgeActivity = ({ tests, now }: { tests: TestsView; now: number }) => {
  const stats = buildStats(buildCells(tests, false));
  const timeouts = tests.mutants.filter((mutant) => mutant.status === "killed_by_timeout").length;
  const activity = tests.activity;
  return (
    <Card className="flex-row flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <ToneBadge tone="running" pulse>
        Test Forge
      </ToneBadge>
      <span className="min-w-0 flex-1 truncate text-sm">{activity?.text ?? "starting"}</span>
      {activity ? (
        <span className="text-muted-foreground font-mono text-xs">{formatDuration(now - Date.parse(activity.at))} ago</span>
      ) : null}
      {stats.total > 0 ? (
        <>
          <Count label="tested" value={stats.run} />
          <Count label="of" value={stats.total} />
          <Count label="killed" value={stats.killed} />
          <Count label="timeout" value={timeouts} />
          <Count label="open" value={stats.survived} />
        </>
      ) : null}
    </Card>
  );
};
