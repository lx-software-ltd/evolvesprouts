import type { ReactNode } from 'react';

import { clsx } from 'clsx';

import { AdminInlineError } from './admin-inline-error';
import { Label } from './label';

export type AdminFieldGridColumns = 1 | 2 | 4;

const columnStyles: Record<AdminFieldGridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

export interface AdminFieldGridProps {
  /** Fields per row on wide screens; collapses to one column on phones. */
  columns: AdminFieldGridColumns;
  children: ReactNode;
  className?: string;
}

/** Editor field layout: rows of 1, 2, or 4 equally sized fields. */
export function AdminFieldGrid({ columns, children, className }: AdminFieldGridProps) {
  return (
    <div className={clsx('grid gap-4', columnStyles[columns], className)} data-columns={columns}>
      {children}
    </div>
  );
}

const spanStyles = {
  1: null,
  2: 'sm:col-span-2',
  full: 'col-span-full',
} as const;

export interface AdminFieldProps {
  /** Visible label; omit when the control renders its own (for example checkbox groups). */
  label?: ReactNode;
  htmlFor?: string;
  /** Columns to span inside the parent grid. */
  span?: keyof typeof spanStyles;
  hint?: ReactNode;
  error?: ReactNode;
  /** Id for the error element; pass the same value as the control's `aria-describedby`. */
  errorId?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** One labelled control inside `AdminFieldGrid`. */
export function AdminField({
  label,
  htmlFor,
  span = 1,
  hint,
  error,
  errorId,
  required,
  className,
  children,
}: AdminFieldProps) {
  return (
    <div className={clsx('min-w-0', spanStyles[span], className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span aria-hidden className='ml-0.5 text-red-600'>
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <AdminInlineError id={errorId} size='xs' className='mt-1'>
          {error}
        </AdminInlineError>
      ) : hint ? (
        <p className='mt-1 text-xs text-slate-500'>{hint}</p>
      ) : null}
    </div>
  );
}
