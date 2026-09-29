import { summariseList, windowOf } from "../../domain/listing/view.ts";
import { writeHandle } from "../../infrastructure/handles.ts";
import type { ListView, PageRequest } from "test-forge-contracts/listing";

export type ListViewInput<TItem> = {
  kind: string;
  items: readonly TItem[];
  label: (item: TItem) => string;
  group?: ((item: TItem) => string) | undefined;
  page?: PageRequest | undefined;
};

export const listView = <TItem>({
  kind,
  items,
  label,
  group,
  page,
}: ListViewInput<TItem>): ListView<TItem> => {
  const summary = summariseList(items, label, group);
  const view: ListView<TItem> = {
    ...summary,
    handle: writeHandle(kind, items),
  };
  if (page === undefined) return view;
  const requested = windowOf(items, page.offset, page.limit);
  return {
    ...view,
    page: {
      offset: page.offset,
      limit: page.limit,
      returned: requested.length,
    },
    items: requested,
  };
};
