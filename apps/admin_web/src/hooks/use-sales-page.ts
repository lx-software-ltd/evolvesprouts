'use client';

import { useCallback, useMemo, useRef } from 'react';

import { getLead } from '@/lib/leads-api';
import type { LeadSummary } from '@/types/leads';

import { useAdminUsers } from './use-admin-users';
import { DRAFT_RECORD_ID, useExpandedRecord } from './use-expanded-record';
import { useExpandedRecordForm } from './use-expanded-record-form';
import { useLeadAnalytics } from './use-lead-analytics';
import { useLeadDetail } from './use-lead-detail';
import { useLeadList } from './use-lead-list';
import { useLeadMutations } from './use-lead-mutations';
import { useQueryTabState } from './use-query-tab-state';
import { useSalesSettings } from './use-sales-settings';

export type SalesView =
  | 'pipeline'
  | 'analytics'
  | 'configuration'
  | 'instagram'
  | 'messenger'
  | 'whatsapp';

export const SALES_VIEW_KEYS: readonly SalesView[] = [
  'pipeline',
  'analytics',
  'configuration',
  'instagram',
  'messenger',
  'whatsapp',
];
export const DEFAULT_SALES_VIEW: SalesView = 'pipeline';

/** Query parameter that mirrors the expanded lead row (`?lead=<id>` or `?lead=new`). */
export const ADMIN_LEAD_QUERY_PARAM = 'lead';

export function useSalesPage() {
  const [activeView, setActiveView] = useQueryTabState<SalesView>(
    SALES_VIEW_KEYS,
    DEFAULT_SALES_VIEW
  );
  const editorDirtyRef = useRef(false);
  const setEditorDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);
  const expanded = useExpandedRecord({
    paramName: ADMIN_LEAD_QUERY_PARAM,
    isDirty: () => editorDirtyRef.current,
  });

  const adminUsers = useAdminUsers();
  const salesSettings = useSalesSettings();
  const leadList = useLeadList();

  const selectedLeadId =
    expanded.expandedId && expanded.expandedId !== DRAFT_RECORD_ID ? expanded.expandedId : null;

  const noop = useCallback(() => {}, []);
  // The in-row editor owns its field state (mounted only while the row is
  // open); a deep-linked lead that is not in the loaded pages is fetched and
  // pinned above the list so its row can render.
  const { pinnedRow } = useExpandedRecordForm<LeadSummary>({
    expandedId: expanded.expandedId,
    rows: leadList.leads,
    isLoading: leadList.isLoading,
    applyRow: noop,
    reset: noop,
    collapse: expanded.collapse,
    fetchMissing: getLead,
  });

  const leadDetail = useLeadDetail(selectedLeadId);
  const leadAnalytics = useLeadAnalytics();

  const { collapse } = expanded;
  const mutations = useLeadMutations({
    onSuccess: async (leadId) => {
      await leadList.refetch();
      if (leadId && leadId === selectedLeadId) {
        await leadDetail.refetch();
      }
      await leadAnalytics.refetch();
    },
  });

  const { createLeadEntry } = mutations;
  const createLead = useCallback(
    async (payload: Parameters<typeof createLeadEntry>[0]) => {
      const created = await createLeadEntry(payload);
      if (created) {
        // The new record now sits in the list; close the draft row.
        editorDirtyRef.current = false;
        collapse();
      }
      return created;
    },
    [collapse, createLeadEntry]
  );

  const selectedLead = useMemo(
    () =>
      leadList.leads.find((entry) => entry.id === selectedLeadId) ??
      (pinnedRow?.id === selectedLeadId ? pinnedRow : null),
    [leadList.leads, pinnedRow, selectedLeadId]
  );

  return {
    activeView,
    setActiveView,
    /** Single-open row state (draft or lead), URL-synced and guarded by `setEditorDirty`. */
    expanded,
    /** Flag unsaved editor changes so switching rows asks first. */
    setEditorDirty,
    selectedLeadId,
    selectedLead,
    /** Deep-linked lead fetched outside the loaded pages; render it above the list. */
    pinnedLead: pinnedRow,
    createLead,
    adminUsers,
    salesSettings,
    leadList,
    leadDetail,
    leadAnalytics,
    mutations,
  };
}
