'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_INSTANCES_LIST_STATUS_FILTER,
  filterInstancesForTable,
  type InstancesListStatusFilter,
} from '@/lib/instance-list-filtering';
import { getInstance } from '@/lib/services-api';
import type { LocationSummary, ServiceInstance } from '@/types/services';

import { useAutoSelectOnce } from './use-auto-select-once';
import { useDuplicateDraftTemplate } from './use-duplicate-draft-template';
import { useEntityPanelEditorShell } from './use-entity-panel-editor-shell';
import { useExpandedRecordForm } from './use-expanded-record-form';
import { useInstanceList } from './use-instance-list';
import { useInstanceMutations } from './use-instance-mutations';
import type { RelatedPartyQuery } from '@/lib/contact-related-links';

/** Query parameter that mirrors the expanded instance row (`?instance=<id>` or `?instance=new`). */
export const ADMIN_INSTANCE_QUERY_PARAM = 'instance';

export interface UseInstancesSectionOptions {
  /** True while the Instances view is shown; the list and row state are parked otherwise. */
  active: boolean;
  locations: LocationSummary[];
  /** Related-party deep link (`?contact=`, `?family=`, `?organization=`). */
  party: RelatedPartyQuery;
  partyFilterKey: string;
}

function noop() {}

/**
 * Row and filter state for the Instances table: server-side scope filters
 * (service, type, party), client-side status/search narrowing, the single
 * expanded instance (URL-synced), the draft's chosen service, the
 * "duplicate as draft" template, and the party deep-link auto-expansion.
 */
export function useInstancesSection({ active, locations, party, partyFilterKey }: UseInstancesSectionOptions) {
  const [serviceFilter, setServiceFilter] = useState('');
  const [serviceTypeFilter, setServiceTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<InstancesListStatusFilter>(
    DEFAULT_INSTANCES_LIST_STATUS_FILTER
  );
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (partyFilterKey) {
      /* eslint-disable react-hooks/set-state-in-effect -- a related-party deep link lists every status */
      setStatusFilter('');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [partyFilterKey]);

  const list = useInstanceList(
    null,
    active
      ? {
          listAllInstances: true,
          filterServiceId: serviceFilter || null,
          filterServiceType: serviceTypeFilter || null,
          filterContactId: party.contactId || null,
          filterFamilyId: party.familyId || null,
          filterOrganizationId: party.organizationId || null,
        }
      : null
  );

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const rows = useMemo(
    () => (active ? filterInstancesForTable(list.instances, { statusFilter, search, locationById }) : []),
    [active, list.instances, statusFilter, search, locationById]
  );

  const duplicate = useDuplicateDraftTemplate<ServiceInstance>();
  const shell = useEntityPanelEditorShell({
    paramName: ADMIN_INSTANCE_QUERY_PARAM,
    onExpandedChange: duplicate.onExpandedChange,
  });
  const { expanded } = shell;
  const expandedId = active ? expanded.expandedId : null;
  const selectedId = active ? shell.selectedId : null;
  /** Service chosen in the draft row (persists across drafts, like the old page-level selection). */
  const [draftServiceId, setDraftServiceId] = useState<string | null>(null);

  useExpandedRecordForm<ServiceInstance>({
    expandedId,
    rows: list.instances,
    isLoading: list.isLoading,
    applyRow: noop,
    reset: noop,
    collapse: expanded.collapse,
  });
  /** Expanded instance hidden by the status/search narrowing; the table pins it above the rows. */
  const pinnedInstance = useMemo(() => {
    if (!selectedId || rows.some((instance) => instance.id === selectedId)) {
      return null;
    }
    return list.instances.find((instance) => instance.id === selectedId) ?? null;
  }, [list.instances, rows, selectedId]);

  const firstPartyInstanceId =
    active && partyFilterKey && !list.isLoading ? (rows[0]?.id ?? null) : null;
  const autoExpandFirstPartyInstance = useCallback(() => {
    if (firstPartyInstanceId) {
      expanded.expand(firstPartyInstanceId);
    }
  }, [expanded, firstPartyInstanceId]);
  useAutoSelectOnce(partyFilterKey, Boolean(firstPartyInstanceId), autoExpandFirstPartyInstance);

  const [optionsCacheVersion, setOptionsCacheVersion] = useState(0);
  const mutations = useInstanceMutations({
    onSuccess: async () => {
      setOptionsCacheVersion((version) => version + 1);
      await list.refetch();
    },
  });

  const duplicateInstance = useCallback(
    async (instance: ServiceInstance) => {
      const full = await getInstance(instance.serviceId, instance.id);
      const template = full ?? instance;
      setDraftServiceId(template.serviceId);
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
    filters: {
      service: serviceFilter,
      setService: setServiceFilter,
      serviceType: serviceTypeFilter,
      setServiceType: setServiceTypeFilter,
      status: statusFilter,
      setStatus: setStatusFilter,
      search,
      setSearch,
    },
    list,
    rows,
    pinnedInstance,
    shell,
    expanded,
    discardPrompt,
    selectedId,
    draftServiceId,
    setDraftServiceId,
    mutations,
    /** Bumps after every instance mutation so dependent option caches (discount codes) refresh. */
    optionsCacheVersion,
    duplicateTemplate: expanded.isDraftOpen ? duplicate.template : null,
    clearDuplicateTemplate: duplicate.clear,
    duplicateInstance,
    refetchList: list.refetch,
  };
}
