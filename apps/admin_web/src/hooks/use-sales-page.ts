'use client';

import { useCallback, useMemo, useState } from 'react';

import { useAdminUsers } from './use-admin-users';
import { useLeadAnalytics } from './use-lead-analytics';
import { useLeadDetail } from './use-lead-detail';
import { useLeadList } from './use-lead-list';
import { useLeadMutations } from './use-lead-mutations';
import { useQueryTabState } from './use-query-tab-state';

export type SalesView = 'pipeline' | 'analytics' | 'instagram' | 'messenger' | 'whatsapp';

export const SALES_VIEW_KEYS: readonly SalesView[] = [
  'pipeline',
  'analytics',
  'instagram',
  'messenger',
  'whatsapp',
];
export const DEFAULT_SALES_VIEW: SalesView = 'pipeline';

export function useSalesPage() {
  const [activeView, setActiveView] = useQueryTabState<SalesView>(
    SALES_VIEW_KEYS,
    DEFAULT_SALES_VIEW
  );
  const [selectedLeadIdState, setSelectedLeadIdState] = useState<string | null | undefined>(
    undefined
  );
  const [isCreateMode, setIsCreateMode] = useState(false);

  const adminUsers = useAdminUsers();
  const leadList = useLeadList();

  const selectedLeadId = useMemo(() => {
    if (isCreateMode) {
      return null;
    }
    if (selectedLeadIdState !== undefined) {
      return selectedLeadIdState;
    }
    return leadList.leads[0]?.id ?? null;
  }, [isCreateMode, leadList.leads, selectedLeadIdState]);

  const setSelectedLeadId = useCallback((leadId: string | null) => {
    setSelectedLeadIdState(leadId);
    setIsCreateMode(false);
  }, []);

  const startCreateLead = useCallback(() => {
    setSelectedLeadIdState(null);
    setIsCreateMode(true);
  }, []);

  const cancelCreateLead = useCallback(() => {
    setIsCreateMode(false);
  }, []);

  const leadDetail = useLeadDetail(selectedLeadId);
  const leadAnalytics = useLeadAnalytics();

  const mutations = useLeadMutations({
    onSuccess: async (leadId) => {
      await leadList.refetch();
      if (leadId) {
        setSelectedLeadIdState(leadId);
      }
      await leadDetail.refetch();
      await leadAnalytics.refetch();
    },
  });

  const selectedLead = useMemo(
    () => leadList.leads.find((entry) => entry.id === selectedLeadId) ?? null,
    [leadList.leads, selectedLeadId]
  );

  return {
    activeView,
    setActiveView,
    selectedLeadId,
    setSelectedLeadId,
    selectedLead,
    isCreateMode,
    startCreateLead,
    cancelCreateLead,
    adminUsers,
    leadList,
    leadDetail,
    leadAnalytics,
    mutations,
  };
}
