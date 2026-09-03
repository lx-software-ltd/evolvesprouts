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
  resetSalesDailyPlanMemory,
} from '@/lib/sales-daily-plan-api';
import type {
  SalesDailyPlanJob,
  SalesDailyPlanSnapshot,
} from '@/types/sales-daily-plan';

import { toErrorMessage } from './hook-errors';

function formatDailyPlanError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) {
    if (error.statusCode === 502 || error.statusCode === 504) {
      return 'The AI model took too long to respond. Please try again in a moment.';
    }
  }
  return toErrorMessage(error, fallback);
}

const EMPTY_SNAPSHOT: SalesDailyPlanSnapshot = { plan: null, memory: [] };

export function useSalesDailyPlan() {
  const queryClient = getAdminQueryClient();
  const queryKey = adminQueryKeys.salesDailyPlan.latest();
  const query = useQuery<SalesDailyPlanSnapshot, unknown>(
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

  const generate = useCallback(
    async (operatorInput?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsGenerating(true);
      setGenerateError('');
      setLastJob(null);
      try {
        const queued = await enqueueSalesDailyPlanJob(operatorInput);
        setLastJob(queued);
        const finished = await pollSalesDailyPlanJob(queued.id, controller.signal);
        setLastJob(finished);
        if (finished.plan) {
          queryClient.setQueryData<SalesDailyPlanSnapshot>(queryKey, (current) => ({
            plan: finished.plan,
            memory: current?.memory ?? [],
          }));
        }
        await queryClient.invalidateQueries({ queryKey });
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return false;
        }
        setGenerateError(formatDailyPlanError(error, 'Failed to generate daily plan.'));
        return false;
      } finally {
        setIsGenerating(false);
      }
    },
    [queryClient, queryKey]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const snapshot = query.data ?? EMPTY_SNAPSHOT;

  return {
    plan: snapshot.plan,
    memory: snapshot.memory,
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

export function useSalesDailyPlanReset() {
  const queryClient = getAdminQueryClient();
  const queryKey = adminQueryKeys.salesDailyPlan.latest();
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const resetMemory = useCallback(async () => {
    setIsResetting(true);
    setResetError('');
    try {
      await resetSalesDailyPlanMemory();
      queryClient.setQueryData<SalesDailyPlanSnapshot>(queryKey, EMPTY_SNAPSHOT);
      await queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      const message = formatDailyPlanError(error, 'Failed to reset sale plan memory.');
      setResetError(message);
      throw error;
    } finally {
      setIsResetting(false);
    }
  }, [queryClient, queryKey]);

  return {
    resetMemory,
    isResetting,
    resetError,
  };
}
