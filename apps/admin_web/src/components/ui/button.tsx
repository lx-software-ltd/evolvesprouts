'use client';

import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

import { SpinnerIcon } from '@/components/icons/action-icons';

const baseStyles =
  'inline-flex items-center justify-center rounded-md text-sm ' +
  'font-semibold transition focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-slate-400 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const variantStyles = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800',
  secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  danger: 'bg-red-600 text-white hover:bg-red-500',
};

const sizeStyles = {
  sm: 'h-8 px-3',
  md: 'h-9 px-4',
  lg: 'h-10 px-5',
};

export const BUTTON_DEFAULT_LOADING_LABEL = 'Saving…';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  /**
   * In-flight API call triggered by this button. The button becomes disabled
   * and swaps its content for a spinner plus `loadingLabel` (default
   * "Saving…") so the operator can see that something is moving.
   */
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  loadingLabel = BUTTON_DEFAULT_LOADING_LABEL,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      data-loading={loading ? 'true' : undefined}
      {...props}
    >
      {loading ? (
        <span className='inline-flex items-center gap-2'>
          <SpinnerIcon className='h-4 w-4 shrink-0 animate-spin' />
          {loadingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
