'use client';

import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import { Label } from './label';

export interface AdminFilterBarProps {
  /** Filter fields (`AdminFilterField`), laid out in one wrapping row. */
  children?: ReactNode;
  /** Right-aligned controls: the create button, exports, refresh. */
  trailing?: ReactNode;
  /** Optional summary under the controls (for example `12 of 340`). */
  summary?: ReactNode;
  className?: string;
}

/**
 * Filter row that sits directly above a record table. Titles live on the
 * filters themselves (labels), not on the table, so the table can start at
 * the top of the page.
 */
export function AdminFilterBar({ children, trailing, summary, className }: AdminFilterBarProps) {
  return (
    <div className={clsx('mb-3 space-y-2', className)} data-testid='admin-filter-bar'>
      <div className='flex flex-wrap items-end gap-3'>
        {children ? <div className='flex min-w-0 flex-1 flex-wrap items-end gap-3'>{children}</div> : null}
        {trailing ? <div className='ml-auto flex shrink-0 items-end gap-2'>{trailing}</div> : null}
      </div>
      {summary ? <p className='text-xs text-slate-500'>{summary}</p> : null}
    </div>
  );
}

export interface AdminFilterFieldProps {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
  /** Width class; defaults to a compact filter width that grows on wide screens. */
  className?: string;
}

export function AdminFilterField({ label, htmlFor, children, className }: AdminFilterFieldProps) {
  return (
    <div className={clsx('min-w-[10rem] flex-1 sm:flex-none sm:basis-48', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
