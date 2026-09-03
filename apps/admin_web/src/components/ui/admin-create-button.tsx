'use client';

import { clsx } from 'clsx';

import { PlusIcon } from '@/components/icons/action-icons';

export interface AdminCreateButtonProps {
  /** Tooltip and accessible name, for example `New contact`; shown as text on phones. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set while the draft row is open so the control reads as toggled. */
  active?: boolean;
  className?: string;
}

/**
 * The create control that opens a draft row above a record table. Square and
 * the same height as the filter inputs on desktop (`sm:h-9`); on phones it
 * fills its own line and spells out the label.
 */
export function AdminCreateButton({ label, onClick, disabled, active, className }: AdminCreateButtonProps) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      onClick={onClick}
      data-testid='admin-create-button'
      className={clsx(
        'inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-sm font-semibold text-white transition',
        'hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'sm:h-9 sm:w-9 sm:px-0',
        className
      )}
    >
      <PlusIcon className='h-4 w-4' />
      <span className='sm:hidden'>{label}</span>
    </button>
  );
}
