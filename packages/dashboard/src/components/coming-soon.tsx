import { Card } from "@/components/ui/card";

export const ComingSoon = ({ title }: { title: string }) => (
  <Card className="flex-1 items-center justify-center gap-1 text-center">
    <h2 className="text-lg font-semibold">{title}</h2>
    <p className="text-muted-foreground text-sm">Coming soon</p>
  </Card>
);
