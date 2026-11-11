import type { ReactNode } from 'react';
import { clsx } from 'clsx';

const variantStyles = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

export interface StatusBannerProps {
  variant: 'info' | 'error' | 'success';
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}

export function StatusBanner({
  variant,
  title,
  children,
  onDismiss,
}: StatusBannerProps) {
  const hasTitle = Boolean(title?.trim());
  const body = (
    <>
      {hasTitle ? <p className='text-xs font-semibold sm:text-sm'>{title}</p> : null}
      <p className={hasTitle ? 'mt-1 text-xs sm:text-sm' : 'text-xs sm:text-sm'}>{children}</p>
    </>
  );

  return (
    <div className={clsx('w-full rounded-lg border px-3 py-2.5 sm:px-4 sm:py-3', variantStyles[variant])}>
      {onDismiss ? (
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>{body}</div>
          <button
            type='button'
            className='shrink-0 text-xs font-semibold underline underline-offset-2'
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      ) : (
        body
      )}
    </div>
  );
}
