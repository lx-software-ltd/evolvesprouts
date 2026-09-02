'use client';

import { startTransition, useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Image from 'next/image';
import Link from 'next/link';

import { NAVBAR_LOCAL_DATETIME_OPTIONS } from '@/lib/format';

import ArrowRightIcon from './icons/svg/arrow-right-icon.svg';
import CloseIcon from './icons/svg/close-icon.svg';
import MenuIcon from './icons/svg/menu-icon.svg';
import { Button } from './ui/button';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'evolvesprouts-admin-sidebar-collapsed';

export interface AppShellNavItem {
  key: string;
  label: string;
  href: string;
}

function SidebarNavLink({
  item,
  activeKey,
  onNavigate,
  onIntent,
}: {
  item: AppShellNavItem;
  activeKey: string;
  onNavigate: () => void;
  onIntent?: (key: string) => void;
}) {
  const isActive = item.key === activeKey;
  const handleIntent = onIntent && !isActive ? () => onIntent(item.key) : undefined;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      onMouseEnter={handleIntent}
      onFocus={handleIntent}
      aria-current={isActive ? 'page' : undefined}
      className={`block w-full rounded-md px-3 py-2 text-left text-sm font-medium transition ${
        isActive
          ? 'bg-slate-900 text-white'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {item.label}
    </Link>
  );
}

export interface AppShellProps {
  leadingNavItems?: AppShellNavItem[];
  navItems: AppShellNavItem[];
  activeKey: string;
  onLogout: () => void;
  /** Hover/focus on a nav link; used to prefetch that section's data. */
  onNavItemIntent?: (key: string) => void;
  userEmail?: string;
  lastAuthTime?: string;
  children: ReactNode;
}

function formatGmtOffset(value: Date): string {
  const offsetMinutesEast = -value.getTimezoneOffset();
  const sign = offsetMinutesEast >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(offsetMinutesEast);
  const hours = Math.floor(absoluteOffsetMinutes / 60);
  const minutes = absoluteOffsetMinutes % 60;
  if (minutes === 0) {
    return `GMT${sign}${hours}`;
  }
  return `GMT${sign}${hours}:${minutes.toString().padStart(2, '0')}`;
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const localTimestamp = parsedDate.toLocaleString(undefined, NAVBAR_LOCAL_DATETIME_OPTIONS);
  return `${localTimestamp} ${formatGmtOffset(parsedDate)}`;
}

export function AppShell({
  leadingNavItems,
  navItems,
  activeKey,
  onLogout,
  onNavItemIntent,
  userEmail,
  lastAuthTime,
  children,
}: AppShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDesktopNavCollapsed, setIsDesktopNavCollapsed] = useState(false);
  const activeLabel = useMemo(() => {
    const fromLeading = leadingNavItems?.find((item) => item.key === activeKey)?.label;
    if (fromLeading) {
      return fromLeading;
    }
    return navItems.find((item) => item.key === activeKey)?.label ?? '';
  }, [activeKey, navItems, leadingNavItems]);
  const formattedLastLoginTime = formatTimestamp(lastAuthTime);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1') {
        startTransition(() => {
          setIsDesktopNavCollapsed(true);
        });
      }
    } catch {
      // ignore
    }
  }, []);

  function setDesktopNavCollapsed(collapsed: boolean) {
    setIsDesktopNavCollapsed(collapsed);
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        collapsed ? '1' : '0'
      );
    } catch {
      // ignore
    }
  }

  return (
    <div className='min-h-screen bg-slate-50 text-slate-900'>
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg'
      >
        Skip to main content
      </a>
      <header className='sticky top-0 z-30 border-b border-slate-200 bg-white'>
        <div className='mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6'>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={() => setIsMobileMenuOpen((previous) => !previous)}
              className='inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 lg:hidden'
              aria-expanded={isMobileMenuOpen}
              aria-label='Toggle navigation'
            >
              {isMobileMenuOpen ? (
                <CloseIcon className='h-4 w-4' />
              ) : (
                <MenuIcon className='h-4 w-4' />
              )}
            </button>
            <Image
              src='/images/evolvesprouts-logo.svg'
              alt=''
              aria-hidden
              width={100}
              height={100}
              className='h-11 w-11 shrink-0 lg:mr-[-20px] lg:mt-[-20px] lg:mb-[-20px] lg:h-[100px] lg:w-[100px]'
            />
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.25em] text-slate-500'>
                Evolve Sprouts Admin
              </p>
              <h1 className='text-lg font-semibold'>{activeLabel || 'Admin'}</h1>
            </div>
          </div>
          <div className='hidden items-center gap-3 lg:flex'>
            {userEmail ? (
              <div className='text-right'>
                <p className='text-sm text-slate-700'>{userEmail}</p>
                {formattedLastLoginTime ? (
                  <p className='text-xs text-slate-500'>Last login: {formattedLastLoginTime}</p>
                ) : null}
              </div>
            ) : null}
            <Button type='button' variant='outline' onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div
        className={clsx(
          'mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6',
          isDesktopNavCollapsed
            ? 'lg:grid-cols-[3rem_minmax(0,1fr)]'
            : 'lg:grid-cols-[220px_minmax(0,1fr)]'
        )}
      >
        <aside
          aria-label='Admin navigation'
          className={clsx(
            isMobileMenuOpen ? 'block' : 'hidden',
            'rounded-xl border border-slate-200 bg-white p-3 lg:block',
            isDesktopNavCollapsed && 'lg:flex lg:flex-col lg:items-center lg:p-2'
          )}
        >
          {userEmail ? (
            <div className='mb-3 border-b border-slate-200 pb-3 lg:hidden'>
              <p className='text-sm text-slate-700'>{userEmail}</p>
              {formattedLastLoginTime ? (
                <p className='mt-1 text-xs text-slate-500'>Last login: {formattedLastLoginTime}</p>
              ) : null}
            </div>
          ) : null}

          <div
            className={clsx(
              'mb-3 hidden w-full flex-col items-center gap-1 border-b border-slate-200 pb-3',
              isDesktopNavCollapsed ? 'lg:flex' : 'lg:hidden'
            )}
          >
            <button
              type='button'
              onClick={() => {
                setDesktopNavCollapsed(false);
              }}
              className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100'
              aria-label='Expand navigation panel'
            >
              <ArrowRightIcon className='h-4 w-4' />
            </button>
          </div>

          <nav
            id='admin-primary-nav'
            className={clsx(isDesktopNavCollapsed && 'lg:hidden')}
          >
            {leadingNavItems && leadingNavItems.length > 0 ? (
              <>
                <div className='space-y-1'>
                  {leadingNavItems.map((item) => (
                    <SidebarNavLink
                      key={item.key}
                      item={item}
                      activeKey={activeKey}
                      onNavigate={() => {
                        setIsMobileMenuOpen(false);
                      }}
                      onIntent={onNavItemIntent}
                    />
                  ))}
                </div>
                <div
                  className='mt-3 border-t border-slate-200'
                  data-testid='leading-nav-divider'
                  role='separator'
                  aria-orientation='horizontal'
                />
                <div className='space-y-1 pt-3'>
                  {navItems.map((item) => (
                    <SidebarNavLink
                      key={item.key}
                      item={item}
                      activeKey={activeKey}
                      onNavigate={() => {
                        setIsMobileMenuOpen(false);
                      }}
                      onIntent={onNavItemIntent}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className='space-y-1'>
                {navItems.map((item) => (
                  <SidebarNavLink
                    key={item.key}
                    item={item}
                    activeKey={activeKey}
                    onNavigate={() => {
                      setIsMobileMenuOpen(false);
                    }}
                    onIntent={onNavItemIntent}
                  />
                ))}
              </div>
            )}
          </nav>

          <div
            className={clsx(
              'mt-3 hidden border-t border-slate-200 pt-3 lg:block',
              isDesktopNavCollapsed && 'lg:hidden'
            )}
          >
            <button
              type='button'
              onClick={() => {
                setDesktopNavCollapsed(true);
              }}
              className='inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-2 py-2 text-slate-700 hover:bg-slate-100'
              aria-label='Collapse navigation panel'
            >
              <ArrowRightIcon className='h-4 w-4 rotate-180' />
            </button>
          </div>

          <div className='mt-3 border-t border-slate-200 pt-3 lg:hidden'>
            <Button
              type='button'
              variant='outline'
              className='w-full'
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLogout();
              }}
            >
              Sign out
            </Button>
          </div>
        </aside>

        <main id='main-content' className='min-w-0'>
          {children}
        </main>
      </div>
    </div>
  );
}
