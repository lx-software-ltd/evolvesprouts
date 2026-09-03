'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Admin listing tables use a single cell padding and header weight everywhere.
 * Prefer `AdminDataTableHeadCell` / `AdminDataTableCell` over ad-hoc `px-*` / `py-*` on `th`/`td`.
 *
 * Below `md` every cell gets `overflow-wrap: anywhere`. With the auto table
 * layout a column can never be narrower than its longest unbreakable token
 * (a `snake_case` table name, a UUID, a timestamp), so one long value makes
 * the whole table wider than its card and the phone has to scroll sideways.
 * `anywhere` counts those break opportunities in the min-content width, so
 * the table always fits its container and only breaks a word when the
 * column really is narrower than that word. Desktop layout is unchanged.
 */
const adminDataTableCellMobileWrap = 'max-md:wrap-anywhere';
const adminDataTableHeadCellBase = `px-4 py-3 text-left font-semibold ${adminDataTableCellMobileWrap}`;
const adminDataTableBodyCellBase = `px-4 py-3 ${adminDataTableCellMobileWrap}`;

export interface AdminDataTableProps {
  children: ReactNode;
  /** Applied to the table element (for example min width). */
  tableClassName?: string;
}

export function AdminDataTable({ children, tableClassName }: AdminDataTableProps) {
  return (
    <div className='rounded-md border border-slate-200'>
      <table className={clsx('w-full divide-y divide-slate-200 text-left', tableClassName)}>
        {children}
      </table>
    </div>
  );
}

export interface AdminDataTableHeadProps {
  children: ReactNode;
  sticky?: boolean;
  className?: string;
}

export function AdminDataTableHead({ children, sticky, className }: AdminDataTableHeadProps) {
  return (
    <thead
      className={clsx(
        'bg-slate-100 text-xs uppercase tracking-[0.08em] text-slate-700',
        sticky && 'sticky top-0 z-10',
        className
      )}
    >
      {children}
    </thead>
  );
}

export function AdminDataTableBody({ children }: { children: ReactNode }) {
  return <tbody className='divide-y divide-slate-200 bg-white text-sm'>{children}</tbody>;
}

/**
 * Mobile-first column priority. `primary` columns always show; `secondary`
 * columns appear from the `md` breakpoint and `tertiary` from `lg`, so a
 * phone sees only the identifying column plus Operations without horizontal
 * scrolling. Pair hidden columns with `AdminDataTableCellMeta` to surface
 * their value under the primary cell on small screens.
 */
export type AdminDataTableColumnPriority = 'primary' | 'secondary' | 'tertiary';

export const ADMIN_TABLE_COLUMN_PRIORITY_CLASS: Record<AdminDataTableColumnPriority, string | null> = {
  primary: null,
  secondary: 'hidden md:table-cell',
  tertiary: 'hidden lg:table-cell',
};

export type AdminDataTableHeadCellProps = Omit<ComponentPropsWithoutRef<'th'>, 'className'> & {
  className?: string;
  priority?: AdminDataTableColumnPriority;
};

export function AdminDataTableHeadCell({
  children,
  className,
  priority = 'primary',
  ...rest
}: AdminDataTableHeadCellProps) {
  return (
    <th
      {...rest}
      className={twMerge(adminDataTableHeadCellBase, ADMIN_TABLE_COLUMN_PRIORITY_CLASS[priority], className)}
    >
      {children}
    </th>
  );
}

export type AdminDataTableCellProps = Omit<ComponentPropsWithoutRef<'td'>, 'className'> & {
  className?: string;
  priority?: AdminDataTableColumnPriority;
};

export function AdminDataTableCell({ children, className, priority = 'primary', ...rest }: AdminDataTableCellProps) {
  return (
    <td
      {...rest}
      className={twMerge(adminDataTableBodyCellBase, ADMIN_TABLE_COLUMN_PRIORITY_CLASS[priority], className)}
    >
      {children}
    </td>
  );
}

export interface AdminDataTableCellMetaProps {
  children: ReactNode;
  /** Breakpoint at which the dedicated column takes over (matches the column's `priority`). */
  until?: Exclude<AdminDataTableColumnPriority, 'primary'>;
  className?: string;
}

/** Secondary line under a primary cell, shown only while its own column is hidden. */
export function AdminDataTableCellMeta({ children, until = 'secondary', className }: AdminDataTableCellMetaProps) {
  return (
    <span
      className={clsx(
        // `wrap-anywhere` (not `truncate`) so a long email or timestamp never
        // sets the column's minimum width and forces a horizontal scroll.
        'mt-0.5 block wrap-anywhere text-xs font-normal text-slate-500',
        until === 'secondary' ? 'md:hidden' : 'lg:hidden',
        className
      )}
    >
      {children}
    </span>
  );
}

export interface AdminDataTableOperationsHeadCellProps {
  children?: ReactNode;
  className?: string;
  scope?: 'col' | 'row';
}

/** Icon-only Operations control: outline button shared by listing tables. */
export const ADMIN_OPS_ICON_LINK_CLASS =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';

/** Standard right-aligned operations column header for admin listing tables. */
export function AdminDataTableOperationsHeadCell({
  children = 'Operations',
  className,
  scope = 'col',
}: AdminDataTableOperationsHeadCellProps) {
  return (
    <th scope={scope} className={twMerge(adminDataTableHeadCellBase, 'text-right', className)}>
      {/* Label stays in the accessibility tree on phones but stops widening the column. */}
      <span className='sr-only md:not-sr-only'>{children}</span>
    </th>
  );
}
