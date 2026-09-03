'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { AdminApiError } from '@/lib/api-admin-client';
import { getAdminQueryClient } from '@/lib/admin-query-client';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  enqueueSalesDailyPlanJob,
  fetchSalesDailyPlan,
  pollSalesDailyPlanJob,
} from '@/lib/sales-daily-plan-api';
import type { SalesDailyPlan, SalesDailyPlanJob } from '@/types/sales-daily-plan';

import { toErrorMessage } from './hook-errors';

function formatDailyPlanError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    if (error.statusCode === 502 || error.statusCode === 504) {
      return 'The AI model took too long to respond. Please try again in a moment.';
    }
  }
  return toErrorMessage(error, fallback);
}

export function useSalesDailyPlan() {
  const queryClient = getAdminQueryClient();
  const queryKey = adminQueryKeys.salesDailyPlan.latest();
  const query = useQuery<SalesDailyPlan | null, unknown>(
    {
      queryKey,
      queryFn: fetchSalesDailyPlan,
    },
    queryClient
  );
  const [lastJob, setLastJob] = useState<SalesDailyPlanJob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setGenerateError('');
    setLastJob(null);
    try {
      const queued = await enqueueSalesDailyPlanJob();
      setLastJob(queued);
      const finished = await pollSalesDailyPlanJob(queued.id, controller.signal);
      setLastJob(finished);
      if (finished.plan) {
        queryClient.setQueryData(queryKey, finished.plan);
      } else {
        await queryClient.invalidateQueries({ queryKey });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      setGenerateError(formatDailyPlanError(error, 'Failed to generate daily plan.'));
    } finally {
      setIsGenerating(false);
    }
  }, [queryClient, queryKey]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    plan: query.data ?? null,
    isLoading: query.isLoading,
    loadError: query.error
      ? formatDailyPlanError(query.error, 'Failed to load daily plan.')
      : '',
    generateError,
    isGenerating,
    lastJob,
    generate,
    cancel,
  };
}
