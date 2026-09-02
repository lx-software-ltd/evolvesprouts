'use client';

import { useEffect, useState, type ReactNode, type TransitionEvent } from 'react';

import { clsx } from 'clsx';

/** Matches `--duration-admin-expand` in globals.css; fallback when no transitionend fires. */
const EXPAND_FALLBACK_MS = 300;

export interface AdminExpandRegionProps {
  open: boolean;
  /** Id of the panel element; pair it with `aria-controls` on the trigger. */
  id: string;
  /** Id of the element naming this region (usually the trigger). */
  labelledBy?: string;
  /**
   * Keep children mounted while collapsed (default) so form state survives.
   * Set to `false` for heavy content that should unmount once the collapse
   * animation settles.
   */
  keepMounted?: boolean;
  /** Fires once the open/close transition has finished. */
  onSettled?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * Animated show/hide wrapper behind `AdminExpandableRow` and
 * `AdminDisclosure`. Height animates through the `.admin-expand` grid track
 * (no measuring); collapsed content is `inert` so it is neither focusable
 * nor read by assistive tech.
 */
export function AdminExpandRegion({
  open,
  id,
  labelledBy,
  keepMounted = true,
  onSettled,
  className,
  children,
}: AdminExpandRegionProps) {
  const [previousOpen, setPreviousOpen] = useState(open);
  const [settled, setSettled] = useState(true);
  if (open !== previousOpen) {
    setPreviousOpen(open);
    setSettled(false);
  }

  useEffect(() => {
    if (settled) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSettled(true);
    }, EXPAND_FALLBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [settled]);

  // Fires on mount for the initial state and after every finished transition.
  useEffect(() => {
    if (settled) {
      onSettled?.(open);
    }
  }, [settled, open, onSettled]);

  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (settled || event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') {
      return;
    }
    setSettled(true);
  }

  const collapsedAndSettled = !open && settled;
  const mounted = keepMounted || open || !settled;

  return (
    <div
      className={clsx('admin-expand', className)}
      data-open={open ? 'true' : 'false'}
      data-settled={settled ? 'true' : 'false'}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        id={id}
        role='region'
        aria-labelledby={labelledBy}
        aria-hidden={collapsedAndSettled ? true : undefined}
        inert={collapsedAndSettled ? true : undefined}
      >
        {mounted ? children : null}
      </div>
    </div>
  );
}
