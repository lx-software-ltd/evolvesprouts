'use client';

import type { TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900',
        'shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500',
        'disabled:cursor-not-allowed disabled:bg-slate-100 sm:text-sm',
        className
      )}
      {...props}
    />
  );
}
