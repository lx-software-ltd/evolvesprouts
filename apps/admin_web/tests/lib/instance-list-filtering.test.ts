import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INSTANCES_LIST_STATUS_FILTER,
  filterInstancesForTable,
  isInstancesListStatusFilter,
} from '@/lib/instance-list-filtering';
import type { LocationSummary, ServiceInstance } from '@/types/services';

const BASE: ServiceInstance = {
  id: 'instance-1',
  serviceId: 'service-1',
  parentServiceTitle: 'Yoga',
  parentServiceTier: null,
  parentServiceKey: null,
  parentServiceType: 'training_course',
  title: null,
  slug: 'instance-1',
  description: null,
  coverImageS3Key: null,
  status: 'in_progress',
  deliveryMode: null,
  locationId: null,
  maxCapacity: null,
  capacityLeftOverride: null,
  capacityLeftEffective: null,
  waitlistEnabled: false,
  eventbriteSyncStatus: 'pending',
  externalUrl: null,
  partnerOrganizations: [],
  instructorId: null,
  notes: null,
  tagIds: [],
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  resolvedTitle: 'Yoga cohort run',
  cohort: 'spring-2024',
  resolvedSlug: 'instance-1',
  resolvedDescription: null,
  resolvedCoverImageS3Key: null,
  resolvedDeliveryMode: null,
  resolvedLocationId: null,
  sessionSlots: [],
  trainingDetails: null,
  resolvedTrainingDetails: null,
  eventTicketTiers: [],
  resolvedEventTicketTiers: [],
  consultationDetails: null,
  resolvedConsultationDetails: null,
};

const NO_LOCATIONS = new Map<string, LocationSummary>();

function filter(instances: ServiceInstance[], overrides: { statusFilter?: '' | 'not_completed' | 'completed'; search?: string } = {}) {
  return filterInstancesForTable(instances, {
    statusFilter: overrides.statusFilter ?? DEFAULT_INSTANCES_LIST_STATUS_FILTER,
    search: overrides.search ?? '',
    locationById: NO_LOCATIONS,
  });
}

describe('filterInstancesForTable', () => {
  it('defaults to hiding completed instances and can show only completed ones', () => {
    const open = { ...BASE, id: 'open', status: 'open' as const };
    const done = { ...BASE, id: 'done', status: 'completed' as const };
    expect(filter([open, done]).map((row) => row.id)).toEqual(['open']);
    expect(filter([open, done], { statusFilter: 'completed' }).map((row) => row.id)).toEqual(['done']);
    expect(filter([open, done], { statusFilter: '' }).map((row) => row.id).sort()).toEqual(['done', 'open']);
  });

  it('matches the cohort by its raw stored value only', () => {
    expect(filter([BASE], { search: 'spring 2024' })).toEqual([]);
    expect(filter([BASE], { search: 'spring-2024' })).toHaveLength(1);
    expect(filter([BASE], { search: 'YOGA' })).toHaveLength(1);
  });

  it('matches partner names and slot venue names through the location lookup', () => {
    const withPartner = {
      ...BASE,
      partnerOrganizations: [{ id: 'p1', name: 'Sunny Kindergarten', active: true, locationId: null }],
      sessionSlots: [
        {
          id: 's1',
          instanceId: BASE.id,
          locationId: 'loc-1',
          startsAt: '2026-05-01T10:00:00Z',
          endsAt: '2026-05-01T12:00:00Z',
          sortOrder: 0,
        },
      ],
    } as ServiceInstance;
    const locations = new Map<string, LocationSummary>([
      [
        'loc-1',
        {
          id: 'loc-1',
          name: 'Harbour Hall',
          areaId: 'area-1',
          address: null,
          lat: null,
          lng: null,
          createdAt: null,
          updatedAt: null,
          lockedFromPartnerOrg: false,
          partnerOrganizationIds: [],
          partnerOrganizationLabels: [],
        },
      ],
    ]);
    expect(
      filterInstancesForTable([withPartner], { statusFilter: '', search: 'sunny', locationById: locations })
    ).toHaveLength(1);
    expect(
      filterInstancesForTable([withPartner], { statusFilter: '', search: 'harbour', locationById: locations })
    ).toHaveLength(1);
  });

  it('orders rows newest first by their first session slot', () => {
    const early = {
      ...BASE,
      id: 'early',
      sessionSlots: [
        { id: 'a', instanceId: 'early', locationId: null, startsAt: '2026-01-01T10:00:00Z', endsAt: null, sortOrder: 0 },
      ],
    } as ServiceInstance;
    const late = {
      ...BASE,
      id: 'late',
      sessionSlots: [
        { id: 'b', instanceId: 'late', locationId: null, startsAt: '2026-06-01T10:00:00Z', endsAt: null, sortOrder: 0 },
      ],
    } as ServiceInstance;
    expect(filter([early, late], { statusFilter: '' }).map((row) => row.id)).toEqual(['late', 'early']);
  });
});

describe('isInstancesListStatusFilter', () => {
  it('accepts only the three toolbar values', () => {
    expect(isInstancesListStatusFilter('')).toBe(true);
    expect(isInstancesListStatusFilter('not_completed')).toBe(true);
    expect(isInstancesListStatusFilter('completed')).toBe(true);
    expect(isInstancesListStatusFilter('open')).toBe(false);
  });
});
