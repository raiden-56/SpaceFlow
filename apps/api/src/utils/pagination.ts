import type { Paginated } from '@spaceflow/shared';

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function skipTake(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
