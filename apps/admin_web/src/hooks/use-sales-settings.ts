'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getSalesSettings,
  updateSalesSettings,
  type SalesSettings,
  type UpdateSalesSettingsRequest,
} from '@/lib/sales-settings-api';

import { toErrorMessage } from './hook-errors';

export function useSalesSettings() {
  const [settings, setSettings] = useState<SalesSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const next = await getSalesSettings();
      setSettings(next);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to load sales settings.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const save = useCallback(async (body: UpdateSalesSettingsRequest) => {
    setIsSaving(true);
    setError('');
    try {
      const next = await updateSalesSettings(body);
      setSettings(next);
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to save sales settings.'));
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { settings, isLoading, isSaving, error, refetch, save };
}
