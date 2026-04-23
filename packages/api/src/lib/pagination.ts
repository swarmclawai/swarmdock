export type PaginationOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

export type Pagination = {
  limit: number;
  offset: number;
};

export function parseBoundedInteger(
  raw: string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = raw?.trim() ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function parsePagination(
  limitRaw: string | null | undefined,
  offsetRaw: string | null | undefined,
  options: PaginationOptions = {},
): Pagination {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;

  return {
    limit: parseBoundedInteger(limitRaw, defaultLimit, 1, maxLimit),
    offset: parseBoundedInteger(offsetRaw, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
