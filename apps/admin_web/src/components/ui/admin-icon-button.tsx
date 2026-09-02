'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { twMerge } from 'tailwind-merge';

/**
 * Every icon-only control in admin tables and toolbars shares one footprint:
 * 32px square, 1px border, white background. Tone only changes the glyph
 * colour so destructive actions stay visually aligned with their siblings.
 */
export const ADMIN_ICON_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white transition ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const toneStyles = {
  default: 'text-slate-700 hover:bg-slate-50',
  danger: 'text-red-600 hover:bg-red-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
  primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
} as const;

export type AdminIconButtonTone = keyof typeof toneStyles;

interface AdminIconButtonCommonProps {
  /** Tooltip and accessible name; icon buttons never render visible text. */
  label: string;
  icon: ReactNode;
  tone?: AdminIconButtonTone;
  /** Small count bubble (for example note count); hidden when 0 or undefined. */
  badge?: number;
  className?: string;
}

export type AdminIconButtonProps = AdminIconButtonCommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label' | 'title'> & {
    href?: undefined;
  };

export type AdminIconLinkProps = AdminIconButtonCommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'aria-label' | 'title'> & {
    href: string;
    disabled?: boolean;
  };

function Badge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className='pointer-events-none absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-semibold leading-none text-white'
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export const AdminIconButton = forwardRef<HTMLButtonElement, AdminIconButtonProps>(
  function AdminIconButton({ label, icon, tone = 'default', badge, className, type = 'button', ...rest }, ref) {
    const classes = twMerge(ADMIN_ICON_BUTTON_BASE_CLASS, toneStyles[tone], badge ? 'relative' : null, className);
    return (
      <button ref={ref} type={type} aria-label={label} title={label} className={classes} {...rest}>
        {icon}
        {badge ? <Badge count={badge} /> : null}
      </button>
    );
  }
);

export function AdminIconLink({
  label,
  icon,
  tone = 'default',
  badge,
  className,
  disabled,
  href,
  onClick,
  ...rest
}: AdminIconLinkProps) {
  const classes = twMerge(ADMIN_ICON_BUTTON_BASE_CLASS, toneStyles[tone], badge ? 'relative' : null, className);
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      aria-disabled={disabled ? true : undefined}
      tabIndex={disabled ? -1 : undefined}
      className={classes}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {icon}
      {badge ? <Badge count={badge} /> : null}
    </a>
  );
}
