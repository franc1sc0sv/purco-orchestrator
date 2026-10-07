import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { STATE_LABEL, STATE_TONE, TONES, type Tone } from "@/lib/colors";
import type { TicketState } from "@/lib/types";
import { cn } from "@/lib/utils";

export const ToneBadge = ({
  tone,
  pulse = false,
  dot = true,
  className,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <Badge
    variant="outline"
    className={cn("gap-1.5 uppercase tracking-wide", TONES[tone].vars, TONES[tone].soft, className)}
  >
    {dot ? (
      <span className={cn("size-2 rounded-full", TONES[tone].dot, pulse && "animate-soft-pulse")} />
    ) : null}
    {children}
  </Badge>
);

export const StateBadge = ({ state }: { state: TicketState }) => (
  <ToneBadge tone={STATE_TONE[state]} pulse={state === "running"}>
    {STATE_LABEL[state]}
  </ToneBadge>
);

export const StateText = ({ state }: { state: TicketState }) => {
  const tone = STATE_TONE[state];
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm", TONES[tone].vars)}>
      <span className={cn("size-2 rounded-full", TONES[tone].dot, state === "running" && "animate-soft-pulse")} />
      <span className={cn(TONES[tone].label !== null && "uppercase tracking-wide")}>
        {TONES[tone].label ?? STATE_LABEL[state]}
      </span>
    </span>
  );
};

export const SizeChip = ({ size }: { size: string | null }) =>
  size === null ? null : (
    <Badge variant="secondary" className="font-mono uppercase">
      {size}
    </Badge>
  );
