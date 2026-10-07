import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const Panel = ({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <Card className={cn("min-h-0 gap-2 py-3", className)}>
    <CardHeader className="flex items-center justify-between gap-2 px-4">
      <CardTitle className="text-sm">{title}</CardTitle>
      {action}
    </CardHeader>
    <CardContent className="relative min-h-0 flex-1 px-0">
      <div className="absolute inset-x-4 inset-y-0">{children}</div>
    </CardContent>
  </Card>
);
