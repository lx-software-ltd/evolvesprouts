'use client';

import { useState, type ReactNode } from 'react';

import { clsx } from 'clsx';

import { ChevronDownIcon } from '@/components/icons/action-icons';

import { AdminExpandRegion } from './admin-expand-region';

export interface AdminDisclosureProps {
  id: string;
  title: ReactNode;
  /** Right-aligned meta next to the title (for example a count or status). */
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled mode; pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders the body read-only (fields disabled) while still allowing expansion. */
  disabled?: boolean;
  className?: string;
}

/**
 * Sub-accordion inside an editor (Location, Tags, Members...). Content stays
 * mounted while collapsed so partially edited fields survive toggling.
 */
export function AdminDisclosure({
  id,
  title,
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  disabled,
  className,
}: AdminDisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;

  function toggle() {
    const next = !open;
    if (!isControlled) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  }

  const body = disabled ? (
    <fieldset disabled className='m-0 min-w-0 border-0 p-0'>
      {children}
    </fieldset>
  ) : (
    children
  );

  return (
    <section
      className={clsx('rounded-md border border-slate-200 bg-slate-50/40', className)}
      data-testid={`${id}-disclosure`}
    >
      <h3 className='m-0'>
        <button
          type='button'
          id={triggerId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className='flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-900 transition hover:bg-slate-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400'
        >
          <span className='min-w-0 flex-1 truncate'>{title}</span>
          {summary ? <span className='text-xs font-normal text-slate-500'>{summary}</span> : null}
          <ChevronDownIcon className='admin-chevron h-4 w-4 shrink-0 text-slate-500' />
        </button>
      </h3>
      <AdminExpandRegion open={open} id={panelId} labelledBy={triggerId}>
        <div className='px-3 pb-3 pt-1'>{body}</div>
      </AdminExpandRegion>
    </section>
  );
}
