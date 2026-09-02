'use client';

import { PlusIcon } from '@/components/icons/action-icons';

import { AdminIconButton } from './admin-icon-button';

export interface AdminCreateButtonProps {
  /** Tooltip and accessible name, for example `New contact`. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set while the draft row is open so the control reads as toggled. */
  active?: boolean;
}

/** The "+" control that opens a draft row above a record table. */
export function AdminCreateButton({ label, onClick, disabled, active }: AdminCreateButtonProps) {
  return (
    <AdminIconButton
      label={label}
      icon={<PlusIcon className='h-4 w-4' />}
      tone='primary'
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active ? true : undefined}
      data-testid='admin-create-button'
    />
  );
}
