'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { clsx } from 'clsx';

import { ChevronDownIcon } from '@/components/icons/action-icons';

import { AdminDataTableCell } from './admin-data-table';
import { AdminExpandRegion } from './admin-expand-region';

const DETAIL_FOCUS_SELECTOR =
  'input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"]';

export interface AdminExpandableRowProps {
  /** Stable record id; also seeds the panel and trigger ids. */
  id: string;
  /** Accessible name for the expand control, for example the contact's name. */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Summary `<td>` cells (use `AdminDataTableCell`). */
  cells: ReactNode;
  /** Operations cell content (`AdminRowActions`); omit when the table has no Operations column. */
  actions?: ReactNode;
  /** Editor rendered inside the expansion; mounted only while open. */
  detail: ReactNode;
  /**
   * Total `<td>` count of the summary row including the expand cell and the
   * Operations cell, so the detail row spans the full width.
   */
  columnCount: number;
  /** Draft rows (unsaved new records) get a distinct tint and no collapse-on-click. */
  isDraft?: boolean;
  /** Move focus into the first field once the expansion settles (default true). */
  autoFocusDetail?: boolean;
  className?: string;
}

/**
 * Table row whose editor opens directly beneath it. Clicking the row (or the
 * chevron) toggles; the Operations cell swallows clicks so actions never
 * toggle the row. Only one row per table should be expanded; see
 * `useExpandedRecord`.
 */
export function AdminExpandableRow({
  id,
  label,
  expanded,
  onToggle,
  cells,
  actions,
  detail,
  columnCount,
  isDraft = false,
  autoFocusDetail = true,
  className,
}: AdminExpandableRowProps) {
  const triggerId = `admin-row-${id}-trigger`;
  const panelId = `admin-row-${id}-panel`;
  const rowRef = useRef<HTMLTableRowElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  // Seeded for rows that mount already expanded (deep links); the child
  // region reports "settled" before this component's effects run.
  const shouldFocusRef = useRef(expanded && autoFocusDetail);

  useEffect(() => {
    if (expanded) {
      shouldFocusRef.current = autoFocusDetail;
    }
  }, [expanded, autoFocusDetail]);

  const handleSettled = useCallback((open: boolean) => {
    if (!open || !shouldFocusRef.current) {
      return;
    }
    shouldFocusRef.current = false;
    const row = rowRef.current;
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
    detailRef.current?.querySelector<HTMLElement>(DETAIL_FOCUS_SELECTOR)?.focus({ preventScroll: true });
  }, []);

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  }

  return (
    <>
      <tr
        ref={rowRef}
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        data-expanded={expanded ? 'true' : 'false'}
        data-draft={isDraft ? 'true' : undefined}
        data-testid={`admin-row-${id}`}
        onClick={onToggle}
        onKeyDown={handleRowKeyDown}
        className={clsx(
          'cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400',
          isDraft ? 'bg-amber-50' : expanded ? 'bg-slate-100' : 'hover:bg-slate-50',
          className
        )}
      >
        <AdminDataTableCell className='w-10 pr-0'>
          <button
            type='button'
            id={triggerId}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className='inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400'
          >
            <ChevronDownIcon className='admin-chevron h-4 w-4' />
          </button>
        </AdminDataTableCell>
        {cells}
        {actions !== undefined ? (
          <AdminDataTableCell
            className='text-right'
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {actions}
          </AdminDataTableCell>
        ) : null}
      </tr>
      <tr
        className='border-0'
        data-testid={`admin-row-${id}-detail`}
        data-expanded={expanded ? 'true' : 'false'}
      >
        <td colSpan={columnCount} className='border-0 p-0'>
          <AdminExpandRegion
            open={expanded}
            id={panelId}
            labelledBy={triggerId}
            keepMounted={false}
            onSettled={handleSettled}
          >
            <div
              ref={detailRef}
              className={clsx(
                'admin-row-detail border-t border-slate-200 px-4 py-4 sm:px-6',
                isDraft ? 'bg-amber-50/40' : 'bg-white'
              )}
            >
              {detail}
            </div>
          </AdminExpandRegion>
        </td>
      </tr>
    </>
  );
}
