'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { AdminApiError } from '@/lib/api-admin-client';
import { getAdminQueryClient } from '@/lib/admin-query-client';
import { adminQueryKeys } from '@/lib/admin-query-keys';
import {
  askSalesDailyPlanQuestion,
  archiveSalesDailyPlanInstruction,
  enqueueSalesDailyPlanJob,
  fetchSalesDailyPlan,
  pollSalesDailyPlanJob,
  resetSalesDailyPlanMemory,
  upsertSalesDailyPlanItemAnnotation,
  upsertSalesDailyPlanPriorityCompletion,
} from '@/lib/sales-daily-plan-api';
import type {
  SalesDailyPlanFeedback,
  SalesDailyPlanItemKind,
  SalesDailyPlanJob,
  SalesDailyPlanPriority,
  SalesDailyPlanSnooze,
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

const EMPTY_SNAPSHOT: SalesDailyPlanSnapshot = {
  plan: null,
  memory: [],
  instructions: [],
  job: null,
};

export function useSalesDailyPlan() {
  const queryClient = getAdminQueryClient();
  const queryKey = adminQueryKeys.salesDailyPlan.latest();
  const query = useQuery<SalesDailyPlanSnapshot, unknown>(
    {
      queryKey,
      queryFn: () => fetchSalesDailyPlan(),
    },
    queryClient
  );
  const [lastJob, setLastJob] = useState<SalesDailyPlanJob | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (operatorInput?: string, operatorInputScope?: 'today' | 'standing') => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsGenerating(true);
      setGenerateError('');
      setLastJob(null);
      try {
        const queued = operatorInputScope
          ? await enqueueSalesDailyPlanJob(operatorInput, operatorInputScope)
          : await enqueueSalesDailyPlanJob(operatorInput);
        setLastJob(queued);
        const finished = await pollSalesDailyPlanJob(queued.id, controller.signal);
        setLastJob(finished);
        if (finished.plan) {
          queryClient.setQueryData<SalesDailyPlanSnapshot>(queryKey, (current) => ({
            plan: finished.plan,
            memory: current?.memory ?? [],
            instructions: current?.instructions ?? [],
            job: finished,
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

  const replacePlan = useCallback(
    (plan: SalesDailyPlanSnapshot['plan']) => {
      queryClient.setQueryData<SalesDailyPlanSnapshot>(queryKey, (current) => ({
        plan,
        memory: current?.memory ?? [],
        instructions: current?.instructions ?? [],
        job: current?.job ?? null,
      }));
    },
    [queryClient, queryKey]
  );

  const currentPlanId = useCallback(() => {
    return queryClient.getQueryData<SalesDailyPlanSnapshot>(queryKey)?.plan?.id;
  }, [queryClient, queryKey]);

  const setPriorityDone = useCallback(
    async (item: SalesDailyPlanPriority, done: boolean) => {
      const planId = currentPlanId();
      if (!planId) {
        throw new Error('No insight is loaded.');
      }
      const plan = await upsertSalesDailyPlanPriorityCompletion({
        planId,
        title: item.title,
        leadId: item.leadId,
        invoiceId: item.invoiceId,
        itemKey: item.itemKey,
        done,
      });
      replacePlan(plan);
    },
    [currentPlanId, replacePlan]
  );

  const annotateItem = useCallback(
    async (input: {
      itemKind: SalesDailyPlanItemKind;
      itemKey: string;
      feedback?: SalesDailyPlanFeedback | null;
      snooze?: SalesDailyPlanSnooze | null;
      draftReply?: string | null;
    }) => {
      const planId = currentPlanId();
      if (!planId) {
        throw new Error('No insight is loaded.');
      }
      const plan = await upsertSalesDailyPlanItemAnnotation({ ...input, planId });
      replacePlan(plan);
    },
    [currentPlanId, replacePlan]
  );

  const askFollowUp = useCallback(
    async (question: string) => {
      const planId = currentPlanId();
      if (!planId) {
        throw new Error('No insight is loaded.');
      }
      const plan = await askSalesDailyPlanQuestion(question, planId);
      replacePlan(plan);
    },
    [currentPlanId, replacePlan]
  );

  const removeInstruction = useCallback(
    async (instructionId: string) => {
      await archiveSalesDailyPlanInstruction(instructionId);
      await queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, queryKey],
  );

  const loadComparison = useCallback(async () => {
    const snapshot = await fetchSalesDailyPlan({ compare: true });
    if (snapshot.plan) {
      replacePlan(snapshot.plan);
    }
  }, [replacePlan]);

  const snapshot = query.data ?? EMPTY_SNAPSHOT;

  return {
    plan: snapshot.plan,
    memory: snapshot.memory,
    instructions: snapshot.instructions ?? [],
    isLoading: query.isLoading,
    loadError: query.error
      ? formatDailyPlanError(query.error, 'Failed to load daily plan.')
      : '',
    generateError,
    isGenerating,
    lastJob: lastJob ?? snapshot.job,
    generate,
    removeInstruction,
    setPriorityDone,
    annotateItem,
    askFollowUp,
    loadComparison,
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
