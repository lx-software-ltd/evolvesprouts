'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Admin listing tables use a single cell padding and header weight everywhere.
 * Prefer `AdminDataTableHeadCell` / `AdminDataTableCell` over ad-hoc `px-*` / `py-*` on `th`/`td`.
 */
const adminDataTableHeadCellBase = 'px-4 py-3 text-left font-semibold';
const adminDataTableBodyCellBase = 'px-4 py-3';

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

export type AdminDataTableHeadCellProps = Omit<ComponentPropsWithoutRef<'th'>, 'className'> & {
  className?: string;
};

export function AdminDataTableHeadCell({ children, className, ...rest }: AdminDataTableHeadCellProps) {
  return (
    <th {...rest} className={twMerge(adminDataTableHeadCellBase, className)}>
      {children}
    </th>
  );
}

export type AdminDataTableCellProps = Omit<ComponentPropsWithoutRef<'td'>, 'className'> & {
  className?: string;
};

export function AdminDataTableCell({ children, className, ...rest }: AdminDataTableCellProps) {
  return (
    <td {...rest} className={twMerge(adminDataTableBodyCellBase, className)}>
      {children}
    </td>
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
      {children}
    </th>
  );
}
