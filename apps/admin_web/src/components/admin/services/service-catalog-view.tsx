'use client';

import { useCallback } from 'react';

import { AdminDiscardChangesDialog } from '@/components/ui/admin-discard-changes-dialog';
import { AdminInlineError } from '@/components/ui/admin-inline-error';
import { AdminEditorSkeleton } from '@/components/ui/admin-skeleton';
import type { useServiceCatalogSection } from '@/hooks/use-service-catalog-section';
import type { useLocationList } from '@/hooks/use-location-list';
import type { useServiceList } from '@/hooks/use-service-list';

import { ServiceDetailPanel } from './service-detail-panel';
import { ServiceListPanel } from './service-list-panel';

export interface ServiceCatalogViewProps {
  catalog: ReturnType<typeof useServiceCatalogSection>;
  serviceList: ReturnType<typeof useServiceList>;
  locationList: ReturnType<typeof useLocationList>;
}

/**
 * Service Catalogue: one record table whose draft row and expanded rows host
 * `ServiceDetailPanel`. The full service is fetched when a row opens; until
 * it arrives the expansion shows the editor skeleton.
 */
export function ServiceCatalogView({ catalog, serviceList, locationList }: ServiceCatalogViewProps) {
  const { shell, expanded, detail, mutations } = catalog;
  const onDirtyChange = useCallback(
    (dirty: boolean) => (dirty ? shell.markDirty() : shell.clearDirty()),
    [shell]
  );

  return (
    <>
      <ServiceListPanel
        services={serviceList.services}
        pinnedService={catalog.pinnedService}
        filters={serviceList.filters}
        isLoading={serviceList.isLoading}
        isLoadingMore={serviceList.isLoadingMore}
        hasMore={serviceList.hasMore}
        error={serviceList.error}
        isMutating={mutations.isLoading}
        onFilterChange={serviceList.setFilter}
        onLoadMore={serviceList.loadMore}
        expanded={expanded}
        onDuplicateService={catalog.duplicateService}
        onDeleteService={async (serviceId) => {
          if (catalog.selectedId === serviceId) {
            shell.clearDirty();
            expanded.collapse();
          }
          await mutations.deleteServiceEntry(serviceId);
        }}
        draftDetail={
          <ServiceDetailPanel
            key={catalog.duplicateTemplate?.id ?? 'create'}
            mode='create'
            service={null}
            createPrefillFromService={catalog.duplicateTemplate}
            locationOptions={locationList.locations}
            isLoadingLocations={locationList.isLoading}
            locationError={locationList.error || undefined}
            isSaving={mutations.isLoading}
            error={mutations.error}
            onDirtyChange={onDirtyChange}
            onCreate={async (payload) => {
              await mutations.createServiceEntry(payload);
              catalog.clearDuplicateTemplate();
              shell.clearDirty();
              expanded.collapse();
            }}
            onUpdate={() => undefined}
            onUploadCover={() => undefined}
          />
        }
        renderDetail={(service) => {
          const loaded = detail.service?.id === service.id ? detail.service : null;
          if (!loaded) {
            return detail.error ? (
              <AdminInlineError>{detail.error}</AdminInlineError>
            ) : (
              <AdminEditorSkeleton label='Loading service…' />
            );
          }
          return (
            <ServiceDetailPanel
              key={service.id}
              mode='edit'
              service={loaded}
              locationOptions={locationList.locations}
              isLoadingLocations={locationList.isLoading}
              locationError={locationList.error || undefined}
              isSaving={mutations.isLoading}
              error={mutations.error || detail.error}
              onDirtyChange={onDirtyChange}
              onCreate={() => undefined}
              onUpdate={async (payload) => {
                await mutations.updateServiceEntry(service.id, payload, true);
              }}
              onUploadCover={async (fileName, contentType) => {
                await mutations.createCoverImageUpload(service.id, {
                  file_name: fileName,
                  content_type: contentType,
                });
              }}
            />
          );
        }}
      />
      <AdminDiscardChangesDialog prompt={catalog.discardPrompt} />
    </>
  );
}
