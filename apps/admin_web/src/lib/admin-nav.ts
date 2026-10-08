export const ADMIN_NAV_DASHBOARD = {
  key: 'dashboard',
  label: 'Dashboard',
  href: '/dashboard',
} as const;

export const ADMIN_NAV_ITEMS = [
  { key: 'assets', label: 'Assets', href: '/assets' },
  { key: 'audit', label: 'Audit', href: '/audit' },
  { key: 'calendar', label: 'Calendar', href: '/calendar' },
  { key: 'contacts', label: 'Contacts', href: '/contacts' },
  { key: 'finance', label: 'Finance', href: '/finance' },
  { key: 'sales', label: 'Sales', href: '/sales' },
  { key: 'services', label: 'Services', href: '/services' },
  { key: 'tags', label: 'Tags', href: '/tags' },
  { key: 'website', label: 'Website', href: '/website' },
] as const;

export type AdminSectionKey =
  | (typeof ADMIN_NAV_DASHBOARD)['key']
  | (typeof ADMIN_NAV_ITEMS)[number]['key'];

export const DEFAULT_ADMIN_SECTION_PATH = '/finance' as const;

/** Default shell section when pathname is unknown; sign-in landing stays Finance (see the admin web rule). */
export const DEFAULT_ADMIN_SECTION_KEY: AdminSectionKey = 'finance';

function normalizePathname(pathname: string | null | undefined): string {
  if (!pathname) {
    return '/';
  }
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function adminSectionKeyFromPathname(
  pathname: string | null | undefined
): AdminSectionKey {
  const normalized = normalizePathname(pathname);
  if (
    normalized === ADMIN_NAV_DASHBOARD.href ||
    normalized.startsWith(`${ADMIN_NAV_DASHBOARD.href}/`)
  ) {
    return ADMIN_NAV_DASHBOARD.key;
  }
  const exact = ADMIN_NAV_ITEMS.find((item) => item.href === normalized);
  if (exact) {
    return exact.key;
  }
  const prefix = ADMIN_NAV_ITEMS.find((item) =>
    normalized.startsWith(`${item.href}/`)
  );
  if (prefix) {
    return prefix.key;
  }
  return DEFAULT_ADMIN_SECTION_KEY;
}
