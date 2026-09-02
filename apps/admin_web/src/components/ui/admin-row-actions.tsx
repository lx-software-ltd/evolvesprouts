'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { clsx } from 'clsx';

import { MoreHorizontalIcon } from '@/components/icons/action-icons';

import { AdminIconButton, AdminIconLink, type AdminIconButtonTone } from './admin-icon-button';

export interface AdminRowAction {
  key: string;
  /** Tooltip, accessible name, and menu item text. */
  label: string;
  icon: ReactNode;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Render as a link (related records) instead of a button. */
  href?: string;
  target?: string;
  rel?: string;
  tone?: AdminIconButtonTone;
  disabled?: boolean;
  badge?: number;
  /** Drop the action entirely (permission or state based). */
  hidden?: boolean;
}

export interface AdminRowActionsProps {
  actions: AdminRowAction[];
  /**
   * Inline controls before the rest collapse into the "more" menu. With the
   * default of 2, three or more actions render as one inline control plus
   * the menu trigger, so the Operations cell never exceeds two buttons.
   */
  maxInline?: number;
  menuLabel?: string;
  className?: string;
}

/**
 * Operations cell contents: icon-only controls of identical size, and an
 * overflow menu once more than `maxInline` actions are available.
 */
export function AdminRowActions({
  actions,
  maxInline = 2,
  menuLabel = 'More actions',
  className,
}: AdminRowActionsProps) {
  const visible = actions.filter((action) => !action.hidden);
  const collapses = visible.length > maxInline;
  const inline = collapses ? visible.slice(0, Math.max(maxInline - 1, 1)) : visible;
  const overflow = collapses ? visible.slice(inline.length) : [];

  return (
    <div
      className={clsx('inline-flex items-center justify-end gap-1', className)}
      data-testid='admin-row-actions'
      onClick={(event) => {
        // Row click toggles the expansion; operations must not.
        event.stopPropagation();
      }}
    >
      {inline.map((action) => (
        <InlineAction key={action.key} action={action} />
      ))}
      {overflow.length > 0 ? <AdminActionMenu actions={overflow} label={menuLabel} /> : null}
    </div>
  );
}

function InlineAction({ action }: { action: AdminRowAction }) {
  if (action.href) {
    return (
      <AdminIconLink
        href={action.href}
        target={action.target}
        rel={action.rel}
        label={action.label}
        icon={action.icon}
        tone={action.tone}
        badge={action.badge}
        disabled={action.disabled}
        onClick={action.onClick}
        data-action={action.key}
      />
    );
  }
  return (
    <AdminIconButton
      label={action.label}
      icon={action.icon}
      tone={action.tone}
      badge={action.badge}
      disabled={action.disabled}
      onClick={action.onClick}
      data-action={action.key}
    />
  );
}

const MENU_GAP_PX = 4;
const MENU_MARGIN_PX = 8;

interface AdminActionMenuProps {
  actions: AdminRowAction[];
  label: string;
}

/**
 * Overflow menu rendered in a portal so table `overflow-x-auto` wrappers do
 * not clip it. Position is written as CSS custom properties on the menu
 * element (see `.admin-action-menu` in globals.css).
 */
function AdminActionMenu({ actions, label }: AdminActionMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 208;
    const menuHeight = menu.offsetHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    let left = rect.right - menuWidth;
    left = Math.max(MENU_MARGIN_PX, Math.min(left, viewportWidth - menuWidth - MENU_MARGIN_PX));
    let top = rect.bottom + MENU_GAP_PX;
    if (top + menuHeight > viewportHeight - MENU_MARGIN_PX && rect.top - menuHeight - MENU_GAP_PX > 0) {
      top = rect.top - menuHeight - MENU_GAP_PX;
    }
    menu.style.setProperty('--admin-menu-top', `${Math.round(top)}px`);
    menu.style.setProperty('--admin-menu-left', `${Math.round(left)}px`);
    menu.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      close(false);
    }
    function handleDismiss() {
      close(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
    };
  }, [open, close]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []
    );
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'ArrowDown':
        event.preventDefault();
        items[(currentIndex + 1) % items.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
        break;
      case 'Home':
        event.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <>
      <AdminIconButton
        ref={triggerRef}
        label={label}
        icon={<MoreHorizontalIcon className='h-4 w-4' />}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        data-testid='admin-row-actions-more'
      />
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role='menu'
              aria-label={label}
              className='admin-action-menu z-50 min-w-52 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg'
              onKeyDown={handleMenuKeyDown}
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {actions.map((action) => (
                <MenuItem
                  key={action.key}
                  action={action}
                  onActivated={() => {
                    close(!action.href);
                  }}
                />
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

const menuItemToneStyles: Record<AdminIconButtonTone, string> = {
  default: 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100',
  danger: 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50',
  success: 'text-emerald-700 hover:bg-emerald-50 focus-visible:bg-emerald-50',
  primary: 'text-slate-900 hover:bg-slate-100 focus-visible:bg-slate-100',
};

function MenuItem({ action, onActivated }: { action: AdminRowAction; onActivated: () => void }) {
  const classes = clsx(
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left outline-none',
    menuItemToneStyles[action.tone ?? 'default'],
    action.disabled && 'cursor-not-allowed opacity-50'
  );
  const iconWrap = <span className='inline-flex h-4 w-4 shrink-0 items-center justify-center'>{action.icon}</span>;
  const badge =
    action.badge ? (
      <span className='ml-auto rounded-full bg-slate-900 px-1.5 text-[10px] font-semibold leading-4 text-white'>
        {action.badge > 99 ? '99+' : action.badge}
      </span>
    ) : null;

  if (action.href) {
    return (
      <a
        role='menuitem'
        href={action.disabled ? undefined : action.href}
        target={action.target}
        rel={action.rel}
        aria-disabled={action.disabled ? true : undefined}
        tabIndex={-1}
        className={classes}
        data-action={action.key}
        onClick={(event) => {
          if (action.disabled) {
            event.preventDefault();
            return;
          }
          action.onClick?.(event);
          onActivated();
        }}
      >
        {iconWrap}
        <span className='min-w-0 flex-1 truncate'>{action.label}</span>
        {badge}
      </a>
    );
  }
  return (
    <button
      type='button'
      role='menuitem'
      aria-disabled={action.disabled ? true : undefined}
      tabIndex={-1}
      className={classes}
      data-action={action.key}
      onClick={(event) => {
        if (action.disabled) {
          return;
        }
        action.onClick?.(event);
        onActivated();
      }}
    >
      {iconWrap}
      <span className='min-w-0 flex-1 truncate'>{action.label}</span>
      {badge}
    </button>
  );
}
