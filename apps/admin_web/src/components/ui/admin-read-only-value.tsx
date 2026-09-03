import type { ReactNode } from 'react';

import { clsx } from 'clsx';

export interface AdminReadOnlyValueProps {
  label: string;
  children: ReactNode;
  /** Monospace value for ids, hashes, and other machine tokens. */
  mono?: boolean;
  className?: string;
}

/**
 * Labelled read-only value for detail panels (audit logs, issued
 * certificates). Sits inside `AdminFieldGrid` next to editable fields.
 */
export function AdminReadOnlyValue({ label, children, mono = false, className }: AdminReadOnlyValueProps) {
  return (
    <div className={clsx('min-w-0 text-sm', className)}>
      <span className='block text-xs font-medium text-slate-500'>{label}</span>
      <div className={mono ? 'mt-1 wrap-anywhere font-mono text-xs text-slate-800' : 'mt-1 text-slate-800'}>
        {children}
      </div>
    </div>
  );
}
