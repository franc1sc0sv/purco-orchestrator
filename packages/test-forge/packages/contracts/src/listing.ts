export const MAX_PAGE_LIMIT = 100;

export const SAMPLE_SIZE = 5;

export type Handle = {
  handleId: string;
  path: string;
  itemCount: number;
  bytes: number;
};

export type ListGroup = {
  key: string;
  count: number;
};

export type ListPage = {
  offset: number;
  limit: number;
  returned: number;
};

export type PageRequest = {
  offset: number;
  limit: number;
};

export type ListRequest = PageRequest & {
  list: string;
};

export type ListView<TItem> = {
  total: number;
  groups: ListGroup[];
  sample: string[];
  handle: Handle;
  page?: ListPage;
  items?: TItem[];
};
