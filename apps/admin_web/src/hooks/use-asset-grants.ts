'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  createAdminAssetGrant,
  deleteAdminAssetGrant,
  listAdminAssetGrants,
} from '@/lib/assets-api';
import type { AssetGrant, CreateAssetGrantInput } from '@/types/assets';

import { toErrorMessage } from './hook-errors';

export interface UseAssetGrantsReturn {
  grants: AssetGrant[];
  isLoadingGrants: boolean;
  grantsError: string;
  grantMutationError: string;
  isSavingGrant: boolean;
  isDeletingGrantId: string | null;
  refreshGrants: (assetId: string) => Promise<void>;
  createGrantEntry: (assetId: string, input: CreateAssetGrantInput) => Promise<void>;
  deleteGrantEntry: (assetId: string, grantId: string) => Promise<void>;
  clearGrantMutationError: () => void;
}

export function useAssetGrants(selectedAssetId: string | null): UseAssetGrantsReturn {
  const [grants, setGrants] = useState<AssetGrant[]>([]);
  const [isLoadingGrants, setIsLoadingGrants] = useState(false);
  const [grantsError, setGrantsError] = useState('');
  const [grantMutationError, setGrantMutationError] = useState('');
  const [isSavingGrant, setIsSavingGrant] = useState(false);
  const [isDeletingGrantId, setIsDeletingGrantId] = useState<string | null>(null);

  const refreshGrants = useCallback(async (assetId: string) => {
    setIsLoadingGrants(true);
    setGrantsError('');

    try {
      const nextGrants = await listAdminAssetGrants(assetId);
      setGrants(nextGrants);
    } catch (error) {
      setGrantsError(toErrorMessage(error, 'Failed to load grants.'));
    } finally {
      setIsLoadingGrants(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedAssetId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset or load when inputs change
      setGrants([]);
      setGrantsError('');
      return;
    }

    void refreshGrants(selectedAssetId);
  }, [refreshGrants, selectedAssetId]);

  const createGrantEntry = useCallback(
    async (assetId: string, input: CreateAssetGrantInput) => {
      setIsSavingGrant(true);
      setGrantMutationError('');

      try {
        await createAdminAssetGrant(assetId, input);
        await refreshGrants(assetId);
      } catch (error) {
        setGrantMutationError(toErrorMessage(error, 'Failed to create grant.'));
        throw error;
      } finally {
        setIsSavingGrant(false);
      }
    },
    [refreshGrants]
  );

  const deleteGrantEntry = useCallback(async (assetId: string, grantId: string) => {
    setIsDeletingGrantId(grantId);
    setGrantMutationError('');

    try {
      await deleteAdminAssetGrant(assetId, grantId);
      setGrants((previous) => previous.filter((grant) => grant.id !== grantId));
    } catch (error) {
      setGrantMutationError(toErrorMessage(error, 'Failed to delete grant.'));
      throw error;
    } finally {
      setIsDeletingGrantId(null);
    }
  }, []);

  const clearGrantMutationError = useCallback(() => {
    setGrantMutationError('');
  }, []);

  return {
    grants,
    isLoadingGrants,
    grantsError,
    grantMutationError,
    isSavingGrant,
    isDeletingGrantId,
    refreshGrants,
    createGrantEntry,
    deleteGrantEntry,
    clearGrantMutationError,
  };
}
