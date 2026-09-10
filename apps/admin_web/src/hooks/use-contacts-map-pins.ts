'use client';

import { useQuery } from '@tanstack/react-query';

import { adminQueryKeys } from '@/lib/admin-query-keys';
import { getAdminQueryClient } from '@/lib/admin-query-client';
import { listAdminContactMapPins, type AdminContactMapPin } from '@/lib/entity-api';

import { toErrorMessage } from './hook-errors';

const EMPTY_PINS: AdminContactMapPin[] = [];

export function fetchAdminContactMapPins() {
  return listAdminContactMapPins();
}

export function useContactsMapPins(enabled: boolean) {
  const queryClient = getAdminQueryClient();
  const query = useQuery(
    {
      queryKey: adminQueryKeys.contactsMapPins.all(),
      queryFn: fetchAdminContactMapPins,
      enabled,
    },
    queryClient
  );

  return {
    pins: query.data ?? EMPTY_PINS,
    isLoading: enabled && query.isPending,
    error: query.error ? toErrorMessage(query.error, 'Failed to load map pins.') : '',
  };
}
