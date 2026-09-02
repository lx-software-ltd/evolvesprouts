'use client';

import { useSharedAdminUsers } from './use-admin-catalog';

export function useAdminUsers() {
  const catalog = useSharedAdminUsers();
  return {
    users: catalog.items,
    isLoading: catalog.isLoading,
    error: catalog.error,
    refetch: catalog.refetch,
  };
}
