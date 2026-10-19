'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getService } from '@/lib/services-api';
import type { ServiceDetail } from '@/types/services';

import { toErrorMessage } from './hook-errors';

export function useServiceDetail(serviceId: string | null) {
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    if (!serviceId) {
      setService(null);
      setError('');
      setIsLoading(false);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError('');
    try {
      const response = await getService(serviceId, controller.signal);
      setService(response);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(toErrorMessage(err, 'Failed to load service detail.'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [serviceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset or load when inputs change
    void refetch();
    return () => {
      abortRef.current?.abort();
    };
  }, [refetch]);

  return {
    service,
    isLoading,
    error,
    refetch,
  };
}
