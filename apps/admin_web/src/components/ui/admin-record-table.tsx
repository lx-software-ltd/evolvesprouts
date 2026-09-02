'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { clsx } from 'clsx';

import { StatusBanner } from '@/components/status-banner';

import { AdminDataTableBody, AdminDataTableCell, AdminDataTableHead } from './admin-data-table';
import { AdminSkeletonRows } from './admin-skeleton';
import { Button } from './button';
import { Card } from './card';

export interface AdminRecordTableProps {
  /** `AdminFilterBar` (with the create button in its trailing slot). */
  filters?: ReactNode;
  /** Header `<tr>`; start with `<AdminDataTableHeadCell />` for the expand column. */
  head: ReactNode;
  /** Body rows, normally `AdminExpandableRow` elements (draft row first). */
  children: ReactNode;
  /** Number of `<td>` cells per row; drives skeleton and empty-state spans. */
  columnCount: number;
  /** Rendered rows (excluding a draft row); used to pick skeleton vs empty state. */
  rowCount: number;
  isLoading: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void | Promise<void>;
  error?: string;
  errorTitle?: string;
  emptyLabel?: string;
  /** Footer line under the table, for example a totals summary. */
  footer?: ReactNode;
  /** Applied to the `<table>`; use it for the minimum width. */
  tableClassName?: string;
  'aria-label': string;
}

/**
 * Table-first listing: a white card (no title) holding the filters and then
 * the table. Shows skeleton rows while the first page loads and keeps
 * existing rows visible while a refetch is in flight.
 */
export function AdminRecordTable({
  filters,
  head,
  children,
  columnCount,
  rowCount,
  isLoading,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  error,
  errorTitle = 'Could not load records',
  emptyLabel = 'No records match the current filters.',
  footer,
  tableClassName,
  'aria-label': ariaLabel,
}: AdminRecordTableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) {
        element.style.setProperty('--admin-table-viewport', `${Math.floor(width)}px`);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const showSkeleton = isLoading && rowCount === 0;
  const showEmpty = !isLoading && !error && rowCount === 0;

  return (
    <Card aria-label={ariaLabel} data-testid='admin-record-table'>
      {filters}
      {error ? (
        <div className='mb-3'>
          <StatusBanner variant='error' title={errorTitle}>
            {error}
          </StatusBanner>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className='admin-record-table-scroll overflow-x-auto rounded-md border border-slate-200 bg-white'
        aria-busy={isLoading || isLoadingMore ? true : undefined}
      >
        <table className={clsx('w-full divide-y divide-slate-200 text-left', tableClassName)}>
          <AdminDataTableHead>{head}</AdminDataTableHead>
          <AdminDataTableBody>
            {children}
            {showSkeleton ? <AdminSkeletonRows columnCount={columnCount} /> : null}
            {showEmpty ? (
              <tr>
                <AdminDataTableCell colSpan={columnCount} className='py-8 text-center text-slate-500'>
                  {emptyLabel}
                </AdminDataTableCell>
              </tr>
            ) : null}
          </AdminDataTableBody>
        </table>
      </div>
      {isLoading && rowCount > 0 ? (
        <p className='mt-2 text-xs text-slate-500' role='status'>
          Refreshing...
        </p>
      ) : null}
      {hasMore && onLoadMore ? (
        <div className='mt-3'>
          <Button type='button' variant='outline' onClick={() => void onLoadMore()} disabled={isLoadingMore}>
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      ) : null}
      {footer ? <div className='mt-2 text-xs text-slate-500'>{footer}</div> : null}
    </Card>
  );
}
