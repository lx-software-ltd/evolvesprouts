'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

import { LeadDetailPanel } from './lead-detail-panel';
import { LeadsTable } from './leads-table';
import { SalesConfigurationView } from './sales-configuration-view';
import { SalesHeader } from './sales-header';
import { MetaConversationsView } from './meta-conversations-view';
import { WhatsAppConversationsView } from './whatsapp-conversations-view';

import { AdminPageErrorBanner } from '@/components/admin/admin-page-error-banner';
import { StatusBanner } from '@/components/status-banner';
import { AdminTabStrip } from '@/components/ui/admin-tab-strip';
import { type SalesView, useSalesPage } from '@/hooks/use-sales-page';
import { formatBulkLeadFailureSummary, runBulkLeadOps } from '@/lib/bulk-lead-ops';
import { updateLead } from '@/lib/leads-api';

const AnalyticsView = dynamic(
  () => import('./analytics-view').then((module) => module.AnalyticsView),
  {
    ssr: false,
    loading: () => (
      <p className='rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600'>
        Loading analytics…
      </p>
    ),
  }
);

const SALES_TAB_ITEMS: { key: SalesView; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'messenger', label: 'Messenger' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

const INBOX_VIEWS = new Set<SalesView>(['instagram', 'messenger', 'whatsapp']);

export function SalesPage() {
  const state = useSalesPage();
  const [bulkActionError, setBulkActionError] = useState('');
  const hasAnyError =
    state.adminUsers.error ||
    state.salesSettings.error ||
    state.leadList.error ||
    state.leadDetail.error ||
    state.leadAnalytics.error ||
    state.mutations.error;

  const refreshAfterBulk = useCallback(async () => {
    await state.leadList.refetch();
    await state.leadDetail.refetch();
    await state.leadAnalytics.refetch();
  }, [state.leadAnalytics, state.leadDetail, state.leadList]);

  return (
    <div className='space-y-4'>
      <AdminPageErrorBanner title='Sales' message={hasAnyError} />
      {bulkActionError ? (
        <StatusBanner variant='error' title='Bulk action partially failed'>
          {bulkActionError}
        </StatusBanner>
      ) : null}

      <AdminTabStrip
        aria-label='Sales views'
        items={SALES_TAB_ITEMS}
        activeKey={state.activeView}
        onChange={state.setActiveView}
      />

      {state.activeView === 'analytics' ? (
        <SalesHeader
          dateRange={state.leadAnalytics.dateRange}
          onDateRangeChange={state.leadAnalytics.setDateRange}
          onRefresh={async () => {
            await state.leadAnalytics.refetch();
          }}
        />
      ) : null}

      {INBOX_VIEWS.has(state.activeView) ? (
        state.activeView === 'whatsapp' ? (
          <WhatsAppConversationsView />
        ) : state.activeView === 'instagram' ? (
          <MetaConversationsView channel='instagram' />
        ) : (
          <MetaConversationsView channel='facebook' />
        )
      ) : state.activeView === 'configuration' ? (
        <SalesConfigurationView
          users={state.adminUsers.users}
          settings={state.salesSettings.settings}
          isLoading={state.salesSettings.isLoading || state.adminUsers.isLoading}
          isSaving={state.salesSettings.isSaving}
          error={state.salesSettings.error}
          onSave={state.salesSettings.save}
        />
      ) : state.activeView === 'pipeline' ? (
        <>
          <LeadDetailPanel
            key={`${state.isCreateMode ? 'create' : 'edit'}-${state.selectedLeadId ?? 'none'}`}
            mode={state.isCreateMode ? 'create' : 'edit'}
            lead={state.leadDetail.lead}
            users={state.adminUsers.users}
            defaultAssignedTo={state.salesSettings.settings?.default_assigned_to ?? null}
            isLoading={state.mutations.isLoading || state.leadDetail.isLoading}
            error={state.mutations.error}
            onStartCreate={state.startCreateLead}
            onCreate={async (payload) => {
              await state.mutations.createLeadEntry(payload);
              state.cancelCreateLead();
            }}
            onUpdate={async (payload) => {
              if (!state.selectedLeadId) {
                return;
              }
              await state.mutations.updateLeadEntry(state.selectedLeadId, payload);
            }}
          />
          <LeadsTable
            leads={state.leadList.leads}
            filters={state.leadList.filters}
            users={state.adminUsers.users}
            selectedLeadId={state.selectedLeadId}
            isCreateMode={state.isCreateMode}
            onCreateLead={state.startCreateLead}
            isLoading={state.leadList.isLoading}
            isLoadingMore={state.leadList.isLoadingMore}
            error={state.leadList.error}
            hasMore={state.leadList.hasMore}
            onLoadMore={state.leadList.loadMore}
            onSelectLead={state.setSelectedLeadId}
            onFilterChange={state.leadList.setFilter}
            onBulkAssign={async (leadIds, assignedTo) => {
              setBulkActionError('');
              const { failed } = await runBulkLeadOps(leadIds, (leadId) =>
                updateLead(leadId, { assigned_to: assignedTo })
              );
              await refreshAfterBulk();
              if (failed.length > 0) {
                setBulkActionError(formatBulkLeadFailureSummary(failed));
              }
            }}
            onBulkStageChange={async (leadIds, stage, lostReason) => {
              setBulkActionError('');
              const { failed } = await runBulkLeadOps(leadIds, (leadId) =>
                updateLead(leadId, {
                  funnel_stage: stage,
                  lost_reason: lostReason ?? null,
                })
              );
              await refreshAfterBulk();
              if (failed.length > 0) {
                setBulkActionError(formatBulkLeadFailureSummary(failed));
              }
            }}
          />
        </>
      ) : (
        <AnalyticsView analytics={state.leadAnalytics.analytics} />
      )}
    </div>
  );
}
