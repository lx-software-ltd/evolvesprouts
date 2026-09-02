'use client';

import { useSharedInstructorUsers } from './use-admin-catalog';

const NO_USERS: never[] = [];

export function useInstructorUsers(enabled: boolean) {
  const catalog = useSharedInstructorUsers({ enabled });
  return {
    users: enabled ? catalog.items : NO_USERS,
    isLoading: enabled && catalog.isLoading,
    error: enabled ? catalog.error : '',
    refetch: catalog.refetch,
  };
}
