'use client';

import type { ReactNode } from 'react';

import { usePathname } from 'next/navigation';

import { AdminAccessDeniedScreen } from '@/components/admin-access-denied-screen';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { LoginScreen } from '@/components/login-screen';
import { StatusBanner } from '@/components/status-banner';
import { usePrefetchAdminSection } from '@/hooks/use-prefetch-admin-section';
import {
  ADMIN_NAV_DASHBOARD,
  ADMIN_NAV_ITEMS,
  adminSectionKeyFromPathname,
} from '@/lib/admin-nav';

export function AdminAuthenticatedShell({ children }: { children: ReactNode }) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();
  const activeSectionKey = adminSectionKeyFromPathname(pathname);
  const prefetchSection = usePrefetchAdminSection();

  if (status === 'loading') {
    return (
      <main className='mx-auto flex min-h-screen max-w-lg items-center px-6'>
        <StatusBanner variant='info' title='Loading'>
          Preparing your admin session.
        </StatusBanner>
      </main>
    );
  }

  if (status === 'authenticated_no_access') {
    return <AdminAccessDeniedScreen onSignOut={logout} />;
  }

  if (status === 'authenticated') {
    return (
      <AppShell
        leadingNavItems={[{ ...ADMIN_NAV_DASHBOARD }]}
        navItems={ADMIN_NAV_ITEMS.map((item) => ({ ...item }))}
        activeKey={activeSectionKey}
        onLogout={logout}
        onNavItemIntent={prefetchSection}
        userEmail={user?.email}
        lastAuthTime={user?.lastAuthTime}
      >
        {children}
      </AppShell>
    );
  }

  return <LoginScreen />;
}
