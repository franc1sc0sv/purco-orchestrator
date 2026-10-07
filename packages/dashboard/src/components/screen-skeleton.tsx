import { Skeleton } from "@/components/ui/skeleton";

export const TicketRowsSkeleton = () => (
  <div className="grid gap-px">
    {[0, 1, 2, 3, 4].map((index) => (
      <Skeleton key={index} className="h-14" />
    ))}
  </div>
);

export const TicketSkeleton = () => (
  <div className="grid size-full grid-rows-[4rem_5rem_minmax(0,1fr)] gap-3">
    <Skeleton className="rounded-xl" />
    <Skeleton className="rounded-xl" />
    <Skeleton className="rounded-xl" />
  </div>
);

export const RowsSkeleton = () => (
  <div className="grid gap-2">
    {[0, 1, 2, 3].map((index) => (
      <Skeleton key={index} className="h-12 rounded-md" />
    ))}
  </div>
);

export const PanelSkeleton = () => <Skeleton className="size-full rounded-xl" />;
