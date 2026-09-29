import { SAMPLE_SIZE } from "test-forge-contracts/listing";
import type { ListGroup } from "test-forge-contracts/listing";

export type ListSummary = {
  total: number;
  groups: ListGroup[];
  sample: string[];
};

export const groupCounts = <TItem>(
  items: readonly TItem[],
  key: (item: TItem) => string
): ListGroup[] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const group = key(item);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([group, count]) => ({ key: group, count }))
    .sort((left, right) =>
      left.count === right.count
        ? left.key.localeCompare(right.key)
        : right.count - left.count
    );
};

export const sampleLabels = <TItem>(
  items: readonly TItem[],
  label: (item: TItem) => string
): string[] => items.slice(0, SAMPLE_SIZE).map(label);

export const summariseList = <TItem>(
  items: readonly TItem[],
  label: (item: TItem) => string,
  key: ((item: TItem) => string) | undefined
): ListSummary => ({
  total: items.length,
  groups: key === undefined ? [] : groupCounts(items, key),
  sample: sampleLabels(items, label),
});

export const windowOf = <TItem>(
  items: readonly TItem[],
  offset: number,
  limit: number
): TItem[] => items.slice(offset, offset + limit);
