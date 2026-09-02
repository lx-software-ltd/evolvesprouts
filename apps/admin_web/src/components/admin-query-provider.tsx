'use client';

import type { ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';

import { getAdminQueryClient } from '@/lib/admin-query-client';

export function AdminQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getAdminQueryClient()}>{children}</QueryClientProvider>;
}
