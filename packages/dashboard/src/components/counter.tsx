import { useAnimatedNumber } from "@/hooks/use-animated-number";

export const Counter = ({
  value,
  format,
  className,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
}) => {
  const shown = useAnimatedNumber(value);
  return <span className={className}>{format(shown)}</span>;
};
