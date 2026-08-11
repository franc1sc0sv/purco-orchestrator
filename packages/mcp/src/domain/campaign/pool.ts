export type PoolWorker<TItem, TResult> = (
  item: TItem,
  slot: number,
) => Promise<TResult>;

export type PoolOptions = {
  slots: number;
  staggerMs?: number;
};

const wait = (ms: number): Promise<void> =>
  new Promise((settle) => {
    setTimeout(settle, ms);
  });

export const boundedSlots = (requested: number, available: number): number =>
  Math.max(1, Math.min(Math.trunc(requested) || 1, available));

export const MAX_REUSE_BATCH = 25;

export const DEFAULT_REUSE_BATCH = 5;

export const boundedReuseBatch = (requested: number | undefined): number => {
  const whole = Math.trunc(Number(requested));
  if (!Number.isFinite(whole) || whole <= 0) return DEFAULT_REUSE_BATCH;
  return Math.min(whole, MAX_REUSE_BATCH);
};

export const chunked = <TItem>(
  items: readonly TItem[],
  size: number,
): TItem[][] => {
  const groups: TItem[][] = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
};

export const runPool = async <TItem, TResult>(
  items: readonly TItem[],
  { slots, staggerMs = 0 }: PoolOptions,
  work: PoolWorker<TItem, TResult>,
): Promise<TResult[]> => {
  const results: TResult[] = [];
  let next = 0;

  const consume = async (slot: number): Promise<void> => {
    if (staggerMs > 0 && slot > 0) await wait(staggerMs * slot);
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await work(item, slot);
    }
  };

  const lanes = Math.max(1, Math.min(slots, items.length));
  await Promise.all(
    Array.from({ length: lanes }, (_unused, slot) => consume(slot)),
  );
  return results;
};
