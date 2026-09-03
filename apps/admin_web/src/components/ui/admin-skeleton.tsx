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

export interface AdminEditorSkeletonProps {
  /** Number of placeholder fields (label + control pairs). */
  fields?: number;
  label?: string;
}

/**
 * Placeholder for an in-row editor whose full record is still loading (for
 * example a service detail fetched on expand). Mirrors a four-column field
 * grid so the expansion does not jump when the real fields arrive.
 */
export function AdminEditorSkeleton({ fields = 8, label = 'Loading…' }: AdminEditorSkeletonProps) {
  return (
    <div role='status' aria-live='polite' aria-label={label} data-testid='admin-editor-skeleton'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className='space-y-1.5'>
            <AdminSkeleton className='h-3 w-1/3' />
            <AdminSkeleton className='h-9 w-full' />
          </div>
        ))}
      </div>
    </div>
  );
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
