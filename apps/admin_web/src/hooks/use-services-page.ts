'use client';

import { useRelatedPartySearchParams } from '@/hooks/use-related-party-search-params';

import { useSharedEntityTags } from './use-admin-catalog';
import { useDiscountCodes } from './use-discount-codes';
import { useInstancesSection } from './use-instances-section';
import { useLocationList } from './use-location-list';
import { useQueryTabState } from './use-query-tab-state';
import { useServiceCatalogSection } from './use-service-catalog-section';
import { useServiceList } from './use-service-list';
import { useVenues } from './use-venues';

export {
  DEFAULT_INSTANCES_LIST_STATUS_FILTER,
  type InstancesListStatusFilter,
} from '@/lib/instance-list-filtering';

export type ServicesView =
  | 'catalog'
  | 'instances'
  | 'discount-codes'
  | 'venues'
  | 'partners'
  | 'certificates';

export const SERVICES_VIEW_KEYS: readonly ServicesView[] = [
  'catalog',
  'instances',
  'discount-codes',
  'venues',
  'partners',
  'certificates',
];
export const DEFAULT_SERVICES_VIEW: ServicesView = 'instances';

/**
 * Page-level state for Services: the active view, the shared lookups every
 * view needs (services, locations, tags), and the two table-first sections
 * with URL-synced row expansion (`?service=`, `?instance=`). Discount codes,
 * venues, partners, and certificates own their row state inside their panels.
 */
export function useServicesPage() {
  const {
    contactId: contactFilterId,
    familyId: familyFilterId,
    organizationId: organizationFilterId,
    partyFilterKey,
  } = useRelatedPartySearchParams();
  const [activeView, setActiveView] = useQueryTabState<ServicesView>(SERVICES_VIEW_KEYS, DEFAULT_SERVICES_VIEW);

  const entityTagsCatalog = useSharedEntityTags();
  const serviceList = useServiceList();
  const locationList = useLocationList();
  const discountCodes = useDiscountCodes();
  const venues = useVenues();

  const catalog = useServiceCatalogSection({ active: activeView === 'catalog', serviceList });
  const instances = useInstancesSection({
    active: activeView === 'instances',
    locations: locationList.locations,
    party: { contactId: contactFilterId, familyId: familyFilterId, organizationId: organizationFilterId },
    partyFilterKey,
  });

  return {
    activeView,
    setActiveView,
    entityTags: entityTagsCatalog.items,
    entityTagsLoading: entityTagsCatalog.isLoading,
    entityTagsError: entityTagsCatalog.error,
    serviceList,
    locationList,
    discountCodes,
    venues,
    catalog,
    instances,
    contactFilterId,
    familyFilterId,
    organizationFilterId,
  };
}
