export const CountStat = ({ value, label }: { value: string | number; label: string }) => (
  <div className="grid text-right">
    <span className="font-mono text-lg leading-tight font-semibold">{value}</span>
    <span className="text-muted-foreground text-[10px] tracking-wider uppercase">{label}</span>
  </div>
);
