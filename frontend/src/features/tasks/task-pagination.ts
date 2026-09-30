export type PaginatedItems<T> = {
  items: T[];
  page: number;
  pageCount: number;
  firstItem: number;
  lastItem: number;
};

export function paginateItems<T>(items: T[], requestedPage: number, pageSize: number): PaginatedItems<T> {
  const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : 10;
  const safePageSize = normalizedPageSize > 0 ? normalizedPageSize : 10;
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1, 1), pageCount);
  const start = (page - 1) * safePageSize;

  return {
    items: items.slice(start, start + safePageSize),
    page,
    pageCount,
    firstItem: items.length ? start + 1 : 0,
    lastItem: Math.min(start + safePageSize, items.length)
  };
}

export function getSelectedVisibleItems<T extends { _id: string }>(
  visibleItems: T[],
  selectedIds: string[],
  isSelectable: (item: T) => boolean
): T[] {
  const selected = new Set(selectedIds);
  return visibleItems.filter(item => selected.has(item._id) && isSelectable(item));
}
