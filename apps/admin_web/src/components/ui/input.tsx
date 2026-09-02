'use client';

import type { InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, type, ...props }: InputProps) {
  const isDatePicker = type === 'date' || type === 'datetime-local';

  return (
    <input
      type={type}
      className={clsx(
        'h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-base',
        'text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none',
        'focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed',
        'disabled:bg-slate-100 sm:h-9 sm:text-sm',
        isDatePicker &&
          'appearance-none [&::-webkit-date-and-time-value]:min-h-0 [&::-webkit-datetime-edit]:p-0 [&::-webkit-datetime-edit-fields-wrapper]:p-0 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:shrink-0 [&::-webkit-calendar-picker-indicator]:p-0',
        className
      )}
      {...props}
    />
  );
}
