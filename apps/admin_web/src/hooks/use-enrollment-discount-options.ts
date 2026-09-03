'use client';

import { useEffect, useState } from 'react';

import { isAbortRequestError, listEnrollmentDiscountOptions } from '@/lib/services-api';
import type { DiscountCode } from '@/types/services';

/** Discount codes an enrollment on this instance may reference (picker + table label lookup). */
export function useEnrollmentDiscountOptions(serviceId: string | null, instanceId: string | null) {
  const [options, setOptions] = useState<DiscountCode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const service = serviceId?.trim();
    const instance = instanceId?.trim();
    if (!service || !instance) {
      setOptions([]);
      setError('');
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setError('');
    void (async () => {
      try {
        const rows = await listEnrollmentDiscountOptions(service, instance, controller.signal);
        if (!controller.signal.aborted) {
          setOptions(rows);
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortRequestError(err)) {
          return;
        }
        setOptions([]);
        setError(err instanceof Error ? err.message : 'Failed to load discount codes');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [serviceId, instanceId]);

  return { options, isLoading, error };
}
