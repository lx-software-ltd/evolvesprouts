import { clsx } from 'clsx';

import { AdminDataTableCell } from './admin-data-table';

export interface AdminSkeletonProps {
  className?: string;
}

/** Neutral shimmer block; size it with width/height classes. */
export function AdminSkeleton({ className }: AdminSkeletonProps) {
  return <span aria-hidden className={clsx('block animate-pulse rounded bg-slate-200', className)} />;
}

export interface AdminSkeletonRowsProps {
  /** Number of `<td>` cells per row, including any leading expand and trailing Operations cells. */
  columnCount: number;
  rows?: number;
}

/**
 * Placeholder rows that keep the table's shape while the first page loads.
 * Cells between the second (identifying) column and the last (Operations)
 * follow the `secondary` column priority so phones see the same silhouette
 * as the loaded table.
 */
export function AdminSkeletonRows({ columnCount, rows = 5 }: AdminSkeletonRowsProps) {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-1/3'];
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} aria-hidden data-testid='admin-skeleton-row'>
          {Array.from({ length: columnCount }, (__, cellIndex) => (
            <AdminDataTableCell
              key={cellIndex}
              priority={cellIndex > 1 && cellIndex < columnCount - 1 ? 'secondary' : 'primary'}
            >
              <AdminSkeleton className={clsx('h-4', widths[(rowIndex + cellIndex) % widths.length])} />
            </AdminDataTableCell>
          ))}
        </tr>
      ))}
    </>
  );
}
