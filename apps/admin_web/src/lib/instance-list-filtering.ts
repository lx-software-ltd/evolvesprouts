import {
  compareInstancesByFirstSlotStartsDesc,
  formatInstanceSlotLocationSummary,
  formatInstanceTableTitle,
  formatServiceTitleWithTier,
} from '@/lib/format';
import type { LocationSummary, ServiceInstance } from '@/types/services';

/** Instances list toolbar status filter; empty string means all statuses. */
export type InstancesListStatusFilter = '' | 'not_completed' | 'completed';

export const DEFAULT_INSTANCES_LIST_STATUS_FILTER: InstancesListStatusFilter = 'not_completed';

export function isInstancesListStatusFilter(value: string): value is InstancesListStatusFilter {
  return value === '' || value === 'not_completed' || value === 'completed';
}

export interface InstanceTableFilterOptions {
  statusFilter: InstancesListStatusFilter;
  /** Free-text search (matched case-insensitively against the searchable summary). */
  search: string;
  locationById: Map<string, LocationSummary>;
}

function instanceSearchText(instance: ServiceInstance, locationById: Map<string, LocationSummary>): string {
  const tableTitle = formatInstanceTableTitle(instance);
  const parts: string[] = [
    tableTitle.trim() !== '' ? tableTitle : null,
    instance.resolvedTitle,
    instance.title,
    instance.parentServiceTitle,
    instance.parentServiceTier,
    instance.parentServiceTitle
      ? formatServiceTitleWithTier(instance.parentServiceTitle, instance.parentServiceTier)
      : null,
    instance.instructorId,
    instance.status,
    formatInstanceSlotLocationSummary(instance, locationById),
  ].filter((value): value is string => Boolean(value));
  const cohortTrimmed = instance.cohort?.trim();
  if (cohortTrimmed) {
    parts.push(cohortTrimmed);
  }
  const locResolved = instance.locationId ?? instance.resolvedLocationId;
  if (locResolved?.trim()) {
    parts.push(locResolved);
  }
  for (const slot of instance.sessionSlots) {
    if (slot.locationId?.trim()) {
      parts.push(slot.locationId);
    }
  }
  for (const partner of instance.partnerOrganizations) {
    if (partner.name?.trim()) {
      parts.push(partner.name);
    }
    if (partner.locationId?.trim()) {
      parts.push(partner.locationId);
    }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Client-side status/search filtering plus newest-first ordering for the
 * Instances table. The API list is already scoped by service, type, and
 * related party; the lifecycle status and free text are narrowed here so
 * they apply instantly to loaded pages.
 */
export function filterInstancesForTable(
  instances: ServiceInstance[],
  { statusFilter, search, locationById }: InstanceTableFilterOptions
): ServiceInstance[] {
  let rows = instances;
  if (statusFilter === 'completed') {
    rows = rows.filter((instance) => instance.status === 'completed');
  } else if (statusFilter === 'not_completed') {
    rows = rows.filter((instance) => instance.status !== 'completed');
  }
  const normalized = search.trim().toLowerCase();
  if (normalized) {
    rows = rows.filter((instance) => instanceSearchText(instance, locationById).includes(normalized));
  }
  return [...rows].sort(compareInstancesByFirstSlotStartsDesc);
}
