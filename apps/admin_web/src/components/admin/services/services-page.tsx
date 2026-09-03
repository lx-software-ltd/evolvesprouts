'use client';

import { AdminPageErrorBanner } from '@/components/admin/admin-page-error-banner';

import { useCompletionCertificates } from '@/hooks/use-completion-certificates';
import { usePartners } from '@/hooks/use-partners';
import { useServicesPage } from '@/hooks/use-services-page';
import type { GeographicAreaSummary, LocationSummary, ServiceSummary } from '@/types/services';

import { CertificatesPanel } from './certificates-panel';
import { DiscountCodesPanel } from './discount-codes-panel';
import { InstancesView } from './instances-view';
import { PartnersPanel } from './partners-panel';
import { ServiceCatalogView } from './service-catalog-view';
import { ServicesHeader } from './services-header';
import { VenuesPanel } from './venues-panel';

export function ServicesPage() {
  const state = useServicesPage();
  const { catalog, instances } = state;
  const serviceOptions = state.serviceList.services;
  const party = {
    contactId: state.contactFilterId,
    familyId: state.familyFilterId,
    organizationId: state.organizationFilterId,
  };
  const hasPartyFilter = Boolean(state.contactFilterId || state.familyFilterId || state.organizationFilterId);

  const hasAnyError =
    state.serviceList.error ||
    catalog.detail.error ||
    catalog.mutations.error ||
    instances.list.error ||
    instances.mutations.error ||
    state.discountCodes.error ||
    state.venues.error;

  return (
    <div className='space-y-4'>
      <AdminPageErrorBanner title='Services' message={hasAnyError} />

      <ServicesHeader activeView={state.activeView} onSetView={state.setActiveView} />

      {state.activeView === 'catalog' ? (
        <ServiceCatalogView catalog={catalog} serviceList={state.serviceList} locationList={state.locationList} />
      ) : state.activeView === 'instances' ? (
        <InstancesView
          instances={instances}
          serviceList={state.serviceList}
          locationList={state.locationList}
          entityTags={state.entityTags}
          entityTagsLoading={state.entityTagsLoading}
          entityTagsError={state.entityTagsError}
          party={party}
          hasPartyFilter={hasPartyFilter}
        />
      ) : state.activeView === 'discount-codes' ? (
        <DiscountCodesPanel
          codes={state.discountCodes.codes}
          filters={state.discountCodes.filters}
          isLoading={state.discountCodes.isLoading}
          isLoadingMore={state.discountCodes.isLoadingMore}
          isSaving={state.discountCodes.isSaving}
          hasMore={state.discountCodes.hasMore}
          error={state.discountCodes.error}
          serviceOptions={serviceOptions}
          serviceDirectoryForDisplay={serviceOptions}
          instanceOptionsRefreshKey={instances.optionsCacheVersion}
          onFilterChange={state.discountCodes.setFilter}
          onLoadMore={state.discountCodes.loadMore}
          onCreate={(payload, options) =>
            state.discountCodes.createCode(payload, {
              suppressSaving: options?.batchSaving,
            })
          }
          onUpdate={state.discountCodes.updateCode}
          onDelete={state.discountCodes.deleteCode}
          onDiscountCodesRefresh={state.discountCodes.refetch}
        />
      ) : state.activeView === 'venues' ? (
        <VenuesPanel
          venues={state.venues.venues}
          geographicAreas={state.venues.geographicAreas}
          areasLoading={state.venues.areasLoading}
          filters={state.venues.filters}
          isLoading={state.venues.isLoading}
          isLoadingMore={state.venues.isLoadingMore}
          isSaving={state.venues.isSaving}
          hasMore={state.venues.hasMore}
          error={state.venues.error}
          onFilterChange={state.venues.setFilter}
          onLoadMore={state.venues.loadMore}
          onCreate={state.venues.createVenue}
          onUpdate={state.venues.updateVenue}
          onUpdatePartial={state.venues.updateVenuePartial}
          onDelete={state.venues.deleteVenue}
        />
      ) : state.activeView === 'certificates' ? (
        <CertificatesView serviceOptions={serviceOptions} />
      ) : (
        <PartnersView
          locations={state.locationList.locations}
          geographicAreas={state.venues.geographicAreas}
          areasLoading={state.venues.areasLoading}
          refreshLocations={async () => {
            await state.locationList.refetch();
          }}
        />
      )}
    </div>
  );
}

function CertificatesView({ serviceOptions }: { serviceOptions: ServiceSummary[] }) {
  const certificates = useCompletionCertificates();
  return <CertificatesPanel certificates={certificates} serviceOptions={serviceOptions} />;
}

function PartnersView({
  locations,
  geographicAreas,
  areasLoading,
  refreshLocations,
}: {
  locations: LocationSummary[];
  geographicAreas: GeographicAreaSummary[];
  areasLoading: boolean;
  refreshLocations: () => Promise<void> | void;
}) {
  const partners = usePartners();
  return (
    <PartnersPanel
      partners={partners}
      locations={locations}
      geographicAreas={geographicAreas}
      areasLoading={areasLoading}
      refreshLocations={refreshLocations}
    />
  );
}
