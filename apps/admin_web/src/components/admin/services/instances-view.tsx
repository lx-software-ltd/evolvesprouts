'use client';

import { useCallback } from 'react';

import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import type { useInstancesSection } from '@/hooks/use-instances-section';
import type { useLocationList } from '@/hooks/use-location-list';
import type { useServiceList } from '@/hooks/use-service-list';
import type { RelatedPartyQuery } from '@/lib/contact-related-links';
import type { EntityTagRef } from '@/lib/entity-api';
import { formatServiceTitleWithTier } from '@/lib/format';
import type { ServiceInstance } from '@/types/services';

import { InstanceDetailPanel } from './instance-detail-panel';
import { InstanceEnrollmentsSection } from './instance-enrollments-section';
import { InstanceListPanel } from './instance-list-panel';

export interface InstancesViewProps {
  instances: ReturnType<typeof useInstancesSection>;
  serviceList: ReturnType<typeof useServiceList>;
  locationList: ReturnType<typeof useLocationList>;
  entityTags: EntityTagRef[];
  entityTagsLoading: boolean;
  entityTagsError: string;
  /** Related-party deep link (`?contact=`, `?family=`, `?organization=`); opens Enrollments on the matched row. */
  party: RelatedPartyQuery;
  hasPartyFilter: boolean;
}

/**
 * Instances: one record table whose draft row and expanded rows host
 * `InstanceDetailPanel`; a saved instance's Enrollments disclosure mounts
 * `InstanceEnrollmentsSection` lazily.
 */
export function InstancesView({
  instances,
  serviceList,
  locationList,
  entityTags,
  entityTagsLoading,
  entityTagsError,
  party,
  hasPartyFilter,
}: InstancesViewProps) {
  const { shell, expanded, mutations } = instances;
  const onDirtyChange = useCallback(
    (dirty: boolean) => (dirty ? shell.markDirty() : shell.clearDirty()),
    [shell]
  );
  const serviceOptions = serviceList.services;
  const draftService = instances.draftServiceId
    ? (serviceOptions.find((service) => service.id === instances.draftServiceId) ?? null)
    : null;

  function serviceTypeFor(instance: ServiceInstance) {
    return (
      instance.parentServiceType ??
      serviceOptions.find((service) => service.id === instance.serviceId)?.serviceType ??
      null
    );
  }

  return (
    <>
      <InstanceListPanel
        instances={instances.rows}
        pinnedInstance={instances.pinnedInstance}
        isLoading={instances.list.isLoading}
        isLoadingMore={instances.list.isLoadingMore}
        hasMore={instances.list.hasMore}
        error={instances.list.error}
        isMutating={mutations.isLoading}
        onLoadMore={instances.list.loadMore}
        expanded={expanded}
        locationOptions={locationList.locations}
        searchFilter={{ value: instances.filters.search, onChange: instances.filters.setSearch }}
        serviceTypeFilter={{ value: instances.filters.serviceType, onChange: instances.filters.setServiceType }}
        statusFilter={{ value: instances.filters.status, onChange: instances.filters.setStatus }}
        serviceFilter={{
          value: instances.filters.service,
          options: serviceOptions.map((service) => ({
            id: service.id,
            title: formatServiceTitleWithTier(service.title, service.serviceTier),
          })),
          onChange: instances.filters.setService,
        }}
        onDuplicateInstance={instances.duplicateInstance}
        onDeleteInstance={async (instanceId, serviceId) => {
          if (instances.selectedId === instanceId) {
            shell.clearDirty();
            expanded.collapse();
          }
          await mutations.deleteInstanceEntry(serviceId, instanceId);
        }}
        draftDetail={
          <InstanceDetailPanel
            key={instances.duplicateTemplate?.id ?? 'create'}
            instance={null}
            createPrefillInstance={instances.duplicateTemplate}
            entityTags={entityTags}
            entityTagsLoading={entityTagsLoading}
            entityTagsError={entityTagsError}
            selectedServiceId={instances.draftServiceId}
            serviceOptions={serviceOptions}
            locationOptions={locationList.locations}
            isLoadingLocations={locationList.isLoading}
            serviceType={draftService?.serviceType ?? null}
            isSaving={mutations.isLoading}
            error={mutations.error}
            locationError={locationList.error}
            onSelectService={instances.setDraftServiceId}
            onDirtyChange={onDirtyChange}
            onCreate={async (serviceId, payload) => {
              await mutations.createInstanceEntry(serviceId, payload);
              instances.clearDuplicateTemplate();
              shell.clearDirty();
              expanded.collapse();
            }}
            onUpdate={() => undefined}
          />
        }
        renderDetail={(instance) => (
          <InstanceDetailPanel
            key={instance.id}
            instance={instance}
            entityTags={entityTags}
            entityTagsLoading={entityTagsLoading}
            entityTagsError={entityTagsError}
            selectedServiceId={instance.serviceId}
            serviceOptions={serviceOptions}
            locationOptions={locationList.locations}
            isLoadingLocations={locationList.isLoading}
            serviceType={serviceTypeFor(instance)}
            isSaving={mutations.isLoading}
            error={mutations.error}
            locationError={locationList.error}
            onSelectService={() => undefined}
            onDirtyChange={onDirtyChange}
            onCreate={() => undefined}
            onUpdate={async (serviceId, instanceId, payload) => {
              await mutations.updateInstanceEntry(serviceId, instanceId, payload);
            }}
            enrollmentsCount={instance.capacityEnrolledCount ?? null}
            enrollmentsDefaultOpen={hasPartyFilter}
            enrollments={
              <InstanceEnrollmentsSection
                serviceId={instance.serviceId}
                instanceId={instance.id}
                autoSelectParty={hasPartyFilter ? party : undefined}
                onEnrollmentsChanged={instances.refetchList}
              />
            }
          />
        )}
      />
      <AdminDiscardChangesDialog prompt={instances.discardPrompt} />
    </>
  );
}
