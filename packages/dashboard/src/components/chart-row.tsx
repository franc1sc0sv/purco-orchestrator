import type { ReactNode } from "react";
import type { ChartConfig } from "@/components/ui/chart";

export const ChartRow = ({
  name,
  config,
  children,
}: {
  name: string;
  config: ChartConfig;
  children: ReactNode;
}) => (
  <>
    <span
      className="size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: `var(--color-${name})` }}
    />
    <span className="text-muted-foreground">{config[name]?.label}</span>
    <span className="ml-auto font-mono font-medium tabular-nums">{children}</span>
  </>
);
