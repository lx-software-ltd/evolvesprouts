'use client';

import { clsx } from 'clsx';

export interface AdminCreateButtonProps {
  /** Visible label and accessible name, for example `New contact`. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set while the draft row is open so the control reads as toggled. */
  active?: boolean;
  className?: string;
}

/**
 * The create control that opens a draft row above a record table. It spells
 * out its label ("New contact", "New note") — no plus icon — and matches the
 * filter input height on desktop (`sm:h-9`); on phones it fills its own line.
 */
export function AdminCreateButton({ label, onClick, disabled, active, className }: AdminCreateButtonProps) {
  return (
    <button
      type='button'
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      onClick={onClick}
      data-testid='admin-create-button'
      className={clsx(
        'inline-flex h-10 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition',
        'hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'sm:h-9 sm:w-auto',
        className
      )}
    >
      {label}
    </button>
  );
}
