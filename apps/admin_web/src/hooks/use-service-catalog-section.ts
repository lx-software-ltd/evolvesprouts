'use client';

import { useCallback, useMemo } from 'react';

import { getService } from '@/lib/services-api';
import type { ServiceDetail, ServiceSummary } from '@/types/services';

import { useDuplicateDraftTemplate } from './use-duplicate-draft-template';
import { useEntityPanelEditorShell } from './use-entity-panel-editor-shell';
import { useExpandedRecordForm } from './use-expanded-record-form';
import { useServiceDetail } from './use-service-detail';
import type { useServiceList } from './use-service-list';
import { useServiceMutations } from './use-service-mutations';

/** Query parameter that mirrors the expanded service row (`?service=<id>` or `?service=new`). */
export const ADMIN_SERVICE_QUERY_PARAM = 'service';

export interface UseServiceCatalogSectionOptions {
  /** True while the Service Catalogue view is shown; the row state is parked otherwise. */
  active: boolean;
  serviceList: ReturnType<typeof useServiceList>;
}

function noop() {}

/**
 * Row state for the Service Catalogue table: the single expanded service
 * (URL-synced), its full detail fetched lazily, the "duplicate as draft"
 * template, and the mutations that refresh both list and detail.
 */
export function useServiceCatalogSection({ active, serviceList }: UseServiceCatalogSectionOptions) {
  const duplicate = useDuplicateDraftTemplate<ServiceDetail>();
  const shell = useEntityPanelEditorShell({
    paramName: ADMIN_SERVICE_QUERY_PARAM,
    onExpandedChange: duplicate.onExpandedChange,
  });
  const { expanded } = shell;
  const expandedId = active ? expanded.expandedId : null;
  const selectedId = active ? shell.selectedId : null;

  const detail = useServiceDetail(selectedId);

  const fetchMissing = useCallback((serviceId: string) => getService(serviceId), []);
  const { pinnedRow: pinnedService } = useExpandedRecordForm<ServiceSummary>({
    expandedId,
    rows: serviceList.services,
    isLoading: serviceList.isLoading,
    applyRow: noop,
    reset: noop,
    collapse: expanded.collapse,
    fetchMissing,
  });

  const mutations = useServiceMutations({
    onSuccess: async () => {
      await serviceList.refetch();
      await detail.refetch();
    },
  });

  const duplicateService = useCallback(
    async (serviceId: string) => {
      const template = await getService(serviceId);
      if (!template) {
        return false;
      }
      duplicate.stage(template, expanded);
      return true;
    },
    [duplicate, expanded]
  );

  const discardPrompt = useMemo(
    () => duplicate.guardDiscardPrompt(expanded.discardPrompt),
    [duplicate, expanded.discardPrompt]
  );

  return {
    shell,
    expanded,
    discardPrompt,
    selectedId,
    detail,
    pinnedService,
    mutations,
    duplicateTemplate: expanded.isDraftOpen ? duplicate.template : null,
    clearDuplicateTemplate: duplicate.clear,
    duplicateService,
  };
}
