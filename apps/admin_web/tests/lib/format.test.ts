import { describe, expect, it } from 'vitest';

import {
  formatContactNameEmailLabel,
  formatAdminContactFullName,
  formatAdminContactPickerLabel,
  formatFamilyOrOrganizationPartyLabel,
  formatBillingEnrollmentPartyCell,
  formatPaymentPartyColumnLabel,
  resolveEnrollmentListPartyLabel,
  compareInstancesByFirstSlotStartsDesc,
  formatAssetContentLanguageLabel,
  formatDate,
  formatDateOnly,
  formatEnumLabel,
  formatInstanceSlotLocationSummary,
  formatInstanceTableCapacity,
  formatInstanceTableTierCohort,
  formatInstanceTableTitle,
  formatTierCohortDisplay,
  formatYmdAsLocalDate,
  ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER,
  formatEnrollmentPickerInstanceServiceDisplay,
  INSTANCE_TABLE_TIER_COHORT_HEADER,
  formatIsoForDatetimeLocalInput,
  formatServiceListPriceLabel,
  formatDiscountCodeInstanceOptionLabel,
  formatDiscountCodeInstanceScopeLabel,
  formatDiscountCodeScopeSummary,
  formatServiceTitleWithTier,
  formatSessionSlotStartsAtDisplay,
  getFirstSessionSlotForDisplay,
  getFirstSessionSlotStartTimeMs,
  getContentLanguageOptions,
  getCurrencyOptions,
  localTodayYmd,
  matchAdminSelectableContentLanguage,
  buildSessionSlotsUtcPayload,
  mapSessionSlotsFromApiToForm,
  orderSessionSlotsForDisplay,
  parseAdminDateTimeInputToIsoUtc,
  parseDatetimeLocalToIsoUtc,
  sessionSlotApiTimesToFormLocals,
} from '@/lib/format';
import type { DiscountCode, ServiceInstance, ServiceSummary, SessionSlot } from '@/types/services';

function baseSummary(overrides: Partial<ServiceSummary> = {}): ServiceSummary {
  return {
    id: 's1',
    instancesCount: 0,
    serviceType: 'training_course',
    title: 'T',
    serviceKey: null,
    bookingSystem: null,
    description: null,
    coverImageS3Key: null,
    deliveryMode: 'online',
    status: 'draft',
    serviceTier: null,
    locationId: null,
    createdBy: 'u',
    createdAt: null,
    updatedAt: null,
    trainingDetails: null,
    eventDetails: null,
    consultationDetails: null,
    ...overrides,
  };
}

describe('format helpers', () => {
  it('formats snake_case values into title case labels', () => {
    expect(formatEnumLabel('training_course')).toBe('Training Course');
    expect(formatEnumLabel('intro_call')).toBe('Intro Call');
    expect(formatEnumLabel('in_person')).toBe('In Person');
    expect(formatEnumLabel('bank__transfer')).toBe('Bank Transfer');
    expect(formatEnumLabel('')).toBe('');
    expect(formatEnumLabel('   ')).toBe('');
    expect(formatEnumLabel('  stripe_card  ')).toBe('Stripe Card');
  });

  it('formats session slot starts for instances table', () => {
    expect(formatSessionSlotStartsAtDisplay(null)).toBe('-');
    expect(formatSessionSlotStartsAtDisplay('')).toBe('-');
    expect(formatSessionSlotStartsAtDisplay('not-a-date')).toBe('-');
    const line = formatSessionSlotStartsAtDisplay('2026-06-15T14:30:00Z');
    expect(line).toMatch(/^\d{2} \w+ @ \d{2}:\d{2}$/);
  });

  it('orders session slots by sort_order then starts_at', () => {
    const slots: SessionSlot[] = [
      { id: 'a', instanceId: null, locationId: null, startsAt: '2026-01-10T10:00:00Z', endsAt: null, sortOrder: 2 },
      { id: 'b', instanceId: null, locationId: null, startsAt: '2026-01-05T10:00:00Z', endsAt: null, sortOrder: 1 },
    ];
    const ordered = orderSessionSlotsForDisplay(slots);
    expect(ordered.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('getFirstSessionSlotForDisplay returns first ordered slot with non-empty startsAt', () => {
    expect(getFirstSessionSlotForDisplay([])).toBeNull();
    expect(
      getFirstSessionSlotForDisplay([
        { id: 'x', instanceId: null, locationId: null, startsAt: null, endsAt: null, sortOrder: 0 },
      ])
    ).toBeNull();
    const slots: SessionSlot[] = [
      { id: 'b', instanceId: null, locationId: null, startsAt: '2026-01-10T10:00:00Z', endsAt: null, sortOrder: 1 },
      { id: 'a', instanceId: null, locationId: null, startsAt: '2026-01-05T10:00:00Z', endsAt: null, sortOrder: 2 },
    ];
    expect(getFirstSessionSlotForDisplay(slots)?.id).toBe('b');
    expect(
      getFirstSessionSlotForDisplay([
        { id: 'empty', instanceId: null, locationId: null, startsAt: '  ', endsAt: null, sortOrder: 0 },
        { id: 'ok', instanceId: null, locationId: null, startsAt: '2026-01-01T10:00:00Z', endsAt: null, sortOrder: 1 },
      ])?.id
    ).toBe('ok');
  });

  it('formats instance table capacity as seats left over max or Unlimited', () => {
    const base = (): ServiceInstance => ({
      id: 'inst-uuid',
      serviceId: 's1',
      parentServiceTitle: 'Workshop',
      parentServiceTier: null,
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst',
      description: null,
      coverImageS3Key: null,
      status: 'open',
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
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'fmt-inst',
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
    });
    expect(formatInstanceTableCapacity(base())).toBe('Unlimited');
    expect(formatInstanceTableCapacity({ ...base(), maxCapacity: 8, capacityEnrolledCount: 2 })).toBe('6/8');
    expect(formatInstanceTableCapacity({ ...base(), maxCapacity: 8, capacityEnrolledCount: 8 })).toBe('0/8');
    expect(formatInstanceTableCapacity({ ...base(), maxCapacity: 5 })).toBe('5/5');
    expect(
      formatInstanceTableCapacity({
        ...base(),
        maxCapacity: 10,
        capacityEnrolledCount: 2,
        capacityLeftEffective: 3,
      })
    ).toBe('3/10');
    expect(
      formatInstanceTableCapacity({
        ...base(),
        maxCapacity: 10,
        capacityEnrolledCount: 2,
        capacityLeftOverride: 1,
        capacityLeftEffective: 1,
      })
    ).toBe('1/10');
  });

  it('formats service title with tier using spaced interpunct when tier is set', () => {
    expect(formatServiceTitleWithTier('Yoga', 'adults')).toBe('Yoga · adults');
    expect(formatServiceTitleWithTier('Yoga', null)).toBe('Yoga');
    expect(formatServiceTitleWithTier('Yoga', '  ')).toBe('Yoga');
  });

  it('formats discount code instance option label with optional tier and cohort', () => {
    const base = (): ServiceInstance => ({
      id: 'inst-uuid',
      serviceId: 's1',
      parentServiceTitle: 'Workshop',
      parentServiceTier: null,
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'fmt-inst',
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
    });
    expect(formatDiscountCodeInstanceOptionLabel(base())).toBe('Workshop');
    expect(formatDiscountCodeInstanceOptionLabel({ ...base(), parentServiceTier: 'standard' })).toBe(
      'Workshop · standard'
    );
    expect(formatDiscountCodeInstanceOptionLabel({ ...base(), cohort: 'March 2026' })).toBe(
      'Workshop · March 2026'
    );
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        parentServiceTier: 'standard',
        cohort: 'March 2026',
      })
    ).toBe('Workshop · standard · March 2026');
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        title: 'Spring cohort',
        parentServiceTier: 't1',
        cohort: 'c1',
      })
    ).toBe('Spring cohort · t1 · c1');
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        parentServiceTitle: null,
        resolvedTitle: 'Resolved only',
        parentServiceTier: 't1',
        cohort: 'c1',
      })
    ).toBe('Resolved only · t1 · c1');
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        title: 'Own title',
        parentServiceTitle: 'Workshop',
      })
    ).toBe('Own title');
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        parentServiceTitle: null,
        resolvedTitle: null,
        title: 'Own title',
      })
    ).toBe('Own title');
    expect(
      formatDiscountCodeInstanceOptionLabel({
        ...base(),
        parentServiceTitle: null,
        resolvedTitle: null,
        title: null,
      })
    ).toBe('inst-uuid');
  });

  it('formats discount code instance scope label same as option label helper', () => {
    const inst: ServiceInstance = {
      id: 'i1',
      serviceId: 's1',
      parentServiceTitle: 'P',
      parentServiceTier: 't',
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: 'Own',
      slug: 'scope-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: 'c',
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'scope-inst',
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
    expect(formatDiscountCodeInstanceScopeLabel(inst)).toBe(formatDiscountCodeInstanceOptionLabel(inst));
  });

  it('formats discount code scope summary for table (editor-aligned service and instance)', () => {
    const svc = baseSummary({ id: 'svc-1', title: 'Yoga', serviceTier: 'adults' });
    const serviceById = new Map<string, ServiceSummary>([[svc.id, svc]]);
    const emptyInstances = new Map<string, ServiceInstance>();

    const unscoped: DiscountCode = {
      id: 'd0',
      code: 'ALL',
      description: null,
      discountType: 'percentage',
      discountValue: '5',
      currency: 'HKD',
      validFrom: null,
      validUntil: null,
      serviceId: null,
      instanceId: null,
      maxUses: null,
      currentUses: 0,
      active: true,
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
    };
    expect(formatDiscountCodeScopeSummary(unscoped, serviceById, emptyInstances)).toBe('All services');

    const serviceOnly: DiscountCode = { ...unscoped, id: 'd1', serviceId: 'svc-1' };
    expect(formatDiscountCodeScopeSummary(serviceOnly, serviceById, emptyInstances)).toBe('Yoga · adults');

    const unknownService: DiscountCode = { ...unscoped, id: 'd2', serviceId: 'missing' };
    expect(formatDiscountCodeScopeSummary(unknownService, serviceById, emptyInstances)).toBe('Service (unknown)');

    const inst: ServiceInstance = {
      id: 'inst-1',
      serviceId: 'svc-1',
      parentServiceTitle: 'Yoga',
      parentServiceTier: 'adults',
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: 'Spring',
      slug: 'spring-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: 'March',
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'spring-inst',
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
    const instanceById = new Map<string, ServiceInstance>([[inst.id, inst]]);
    const instanceScoped: DiscountCode = {
      ...unscoped,
      id: 'd3',
      serviceId: 'svc-1',
      instanceId: 'inst-1',
    };
    expect(formatDiscountCodeScopeSummary(instanceScoped, serviceById, instanceById)).toBe('Spring · adults · March');

    const instanceScopedNoFetch: DiscountCode = {
      ...unscoped,
      id: 'd4',
      serviceId: 'svc-1',
      instanceId: 'inst-missing',
    };
    expect(formatDiscountCodeScopeSummary(instanceScopedNoFetch, serviceById, emptyInstances)).toBe(
      'Yoga · adults'
    );
  });

  it('formats instance table title from own title or parent service title', () => {
    const base = (): ServiceInstance => ({
      id: 'i1',
      serviceId: 's1',
      parentServiceTitle: 'Parent',
      parentServiceTier: 'tier-a',
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: 'Resolved',
      resolvedSlug: 'fmt-inst',
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
    });
    expect(formatInstanceTableTitle({ ...base(), title: '  My run  ' })).toBe('My run');
    expect(formatInstanceTableTitle(base())).toBe('Parent');
    expect(
      formatInstanceTableTitle({
        ...base(),
        title: null,
        parentServiceTitle: null,
      })
    ).toBe('');
    expect(formatInstanceTableTitle({ ...base(), title: 'My run', cohort: 'spring-2024' })).toBe('My run');
    expect(formatInstanceTableTitle({ ...base(), cohort: 'spring-2024' })).toBe('Parent');
    expect(
      formatInstanceTableTitle({
        ...base(),
        title: null,
        parentServiceTitle: null,
        parentServiceTier: null,
        cohort: 'spring-2024',
      })
    ).toBe('');
  });

  it('formats instance table tier and cohort with interpunct when both are set', () => {
    const base = (): ServiceInstance => ({
      id: 'i1',
      serviceId: 's1',
      parentServiceTitle: 'Parent',
      parentServiceTier: 'tier-a',
      parentServiceType: 'training_course',
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: 'Resolved',
      resolvedSlug: 'fmt-inst',
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
    });
    expect(INSTANCE_TABLE_TIER_COHORT_HEADER).toBe('Tier \u00b7 Cohort');
    expect(ENROLLMENT_PICKER_INSTANCE_SERVICE_HEADER).toBe('Instance \u00b7 Service');
    expect(formatInstanceTableTierCohort(base())).toBe('tier-a');
    expect(formatInstanceTableTierCohort({ ...base(), cohort: 'spring-2024' })).toBe('tier-a \u00b7 spring-2024');
    expect(
      formatInstanceTableTierCohort({
        ...base(),
        parentServiceTier: null,
        cohort: '  spring-2024  ',
      })
    ).toBe('spring-2024');
    expect(
      formatInstanceTableTierCohort({
        ...base(),
        parentServiceTier: '  ',
        cohort: null,
      })
    ).toBe('');
  });

  it('formatEnrollmentPickerInstanceServiceDisplay prefers instance title then parent service', () => {
    expect(
      formatEnrollmentPickerInstanceServiceDisplay({
        instanceTitle: '  Spring cohort  ',
        parentServiceTitle: 'Ignored',
      })
    ).toBe('Spring cohort');
    expect(
      formatEnrollmentPickerInstanceServiceDisplay({
        instanceTitle: null,
        parentServiceTitle: 'Parent Name',
      })
    ).toBe('Parent Name');
    expect(formatEnrollmentPickerInstanceServiceDisplay({ instanceTitle: '', parentServiceTitle: null })).toBe('');
  });

  it('formatTierCohortDisplay mirrors instance tier/cohort cell rules', () => {
    expect(formatTierCohortDisplay('tier-a', null)).toBe('tier-a');
    expect(formatTierCohortDisplay(null, 'spring-2024')).toBe('spring-2024');
    expect(formatTierCohortDisplay('t1', 'c1')).toBe('t1 \u00b7 c1');
    expect(formatTierCohortDisplay('  ', null)).toBe('');
    expect(formatTierCohortDisplay(null, '  spring-2024  ')).toBe('spring-2024');
  });

  it('summarizes instance locations including partner org venues', () => {
    const locById = new Map([
      [
        'loc-a',
        {
          id: 'loc-a',
          name: 'Hall A',
          areaId: 'area-1',
          address: null,
          lat: null,
          lng: null,
          createdAt: null,
          updatedAt: null,
          lockedFromPartnerOrg: false,
          partnerOrganizationLabels: [],
          partnerOrganizationIds: [],
        },
      ],
      [
        'loc-b',
        {
          id: 'loc-b',
          name: 'Partner venue',
          areaId: 'area-1',
          address: null,
          lat: null,
          lng: null,
          createdAt: null,
          updatedAt: null,
          lockedFromPartnerOrg: true,
          partnerOrganizationLabels: ['Co'],
          partnerOrganizationIds: ['org-1'],
        },
      ],
    ]);
    const instance: ServiceInstance = {
      id: 'i1',
      serviceId: 's1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceType: null,
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst-b',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: null,
      locationId: 'loc-a',
      maxCapacity: null,
      capacityLeftOverride: null,
      capacityLeftEffective: null,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [
        { id: 'org-1', name: 'Co', active: true, locationId: 'loc-b' },
      ],
      instructorId: null,
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'fmt-inst-b',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: null,
      sessionSlots: [
        {
          id: 'slot-1',
          instanceId: 'i1',
          locationId: 'loc-a',
          startsAt: '2026-01-01T10:00:00Z',
          endsAt: null,
          sortOrder: 0,
        },
      ],
      trainingDetails: null,
      resolvedTrainingDetails: null,
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };
    expect(formatInstanceSlotLocationSummary(instance, locById)).toBe('Hall A · Co');
  });

  it('uses earliest ordered slot time for instance sort key', () => {
    const slots: SessionSlot[] = [
      { id: 'late', instanceId: null, locationId: null, startsAt: '2026-02-01T10:00:00Z', endsAt: null, sortOrder: 2 },
      { id: 'early', instanceId: null, locationId: null, startsAt: '2026-01-01T10:00:00Z', endsAt: null, sortOrder: 1 },
    ];
    expect(getFirstSessionSlotStartTimeMs(slots)).toBe(new Date('2026-01-01T10:00:00Z').getTime());
  });

  it('sorts instances by first slot start descending', () => {
    const mk = (id: string, startsAt: string | null): ServiceInstance => ({
      id,
      serviceId: 'svc',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceType: null,
      parentServiceKey: null,
      title: null,
      slug: 'fmt-inst-b',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
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
      cohort: null,
      notes: null,
      tagIds: [],
      createdBy: 'u',
      createdAt: null,
      updatedAt: null,
      resolvedTitle: null,
      resolvedSlug: 'fmt-inst-b',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: null,
      sessionSlots: startsAt
        ? [
            {
              id: 's',
              instanceId: id,
              locationId: null,
              startsAt,
              endsAt: null,
              sortOrder: 0,
            },
          ]
        : [],
      trainingDetails: null,
      resolvedTrainingDetails: null,
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    });
    const later = mk('b', '2026-06-01T12:00:00Z');
    const earlier = mk('a', '2026-05-01T12:00:00Z');
    const noSlots = mk('c', null);
    const sorted = [earlier, noSlots, later].sort(compareInstancesByFirstSlotStartsDesc);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('formats service list price labels by service type', () => {
    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'training_course',
          trainingDetails: {
            pricingUnit: 'per_person',
            defaultPrice: '100',
            defaultCurrency: 'HKD',
          },
        })
      )
    ).toBe('HK$100.00');

    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'event',
          trainingDetails: null,
          eventDetails: {
            eventCategory: 'workshop',
            defaultPrice: '50',
            defaultCurrency: 'USD',
          },
        })
      )
    ).toBe('US$50.00');

    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'consultation',
          trainingDetails: null,
          consultationDetails: {
            consultationFormat: 'one_on_one',
            maxGroupSize: null,
            durationMinutes: 60,
            pricingModel: 'free',
            defaultHourlyRate: null,
            defaultPackagePrice: null,
            defaultPackageSessions: null,
            defaultCurrency: 'HKD',
          },
        })
      )
    ).toBe('Free');

    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'intro_call',
          trainingDetails: null,
          consultationDetails: {
            consultationFormat: 'one_on_one',
            maxGroupSize: null,
            durationMinutes: 15,
            pricingModel: 'free',
            defaultHourlyRate: null,
            defaultPackagePrice: null,
            defaultPackageSessions: null,
            defaultCurrency: 'HKD',
          },
        })
      )
    ).toBe('Free');

    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'consultation',
          trainingDetails: null,
          consultationDetails: {
            consultationFormat: 'one_on_one',
            maxGroupSize: null,
            durationMinutes: null,
            pricingModel: 'hourly',
            defaultHourlyRate: '200',
            defaultPackagePrice: null,
            defaultPackageSessions: null,
            defaultCurrency: 'HKD',
          },
        })
      )
    ).toBe('HK$200.00 / hr');

    expect(
      formatServiceListPriceLabel(
        baseSummary({
          serviceType: 'consultation',
          trainingDetails: null,
          consultationDetails: {
            consultationFormat: 'group',
            maxGroupSize: 4,
            durationMinutes: null,
            pricingModel: 'package',
            defaultHourlyRate: null,
            defaultPackagePrice: '1200',
            defaultPackageSessions: 6,
            defaultCurrency: 'HKD',
          },
        })
      )
    ).toBe('HK$1,200.00 (6 sessions)');
  });

  it('exposes HKD, USD, EUR, GBP, CNY, and SGD in currency options with expected labels', () => {
    const options = getCurrencyOptions();
    expect(options.map((o) => o.value)).toEqual(['HKD', 'USD', 'EUR', 'GBP', 'CNY', 'SGD']);
    expect(options.some((option) => option.value === 'HKD' && option.label === 'HKD Hong Kong Dollar')).toBe(true);
  });

  it('exposes en, zh-CN, and zh-HK in content language options with fixed labels', () => {
    const options = getContentLanguageOptions();
    expect(options.map((o) => o.value)).toEqual(['en', 'zh-CN', 'zh-HK']);
    expect(options.find((o) => o.value === 'en')?.label).toBe('English');
    expect(options.find((o) => o.value === 'zh-CN')?.label).toBe('Mandarin (Simplified)');
    expect(options.find((o) => o.value === 'zh-HK')?.label).toBe('Cantonese (Hong Kong)');
  });

  it('formats known content_language tags and shows raw values for unknown tags', () => {
    expect(formatAssetContentLanguageLabel('en')).toBe('English');
    expect(formatAssetContentLanguageLabel(null)).toBe('—');
    expect(formatAssetContentLanguageLabel('fr')).toBe('fr');
  });

  it('classifies stored content_language against the admin allowlist', () => {
    expect(matchAdminSelectableContentLanguage('zh-HK')).toBe('zh-HK');
    expect(matchAdminSelectableContentLanguage('  ')).toBe(null);
    expect(matchAdminSelectableContentLanguage('fr')).toBe('unrecognized');
  });

  it('formats dates in the local timezone and default locale', () => {
    const iso = '2026-03-01T10:00:00Z';
    const parsed = new Date(iso);
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
    expect(formatDate(iso)).toBe(expected);
    expect(formatDate(null)).toBe('—');
  });

  it('formats date-only values in the local timezone and default locale', () => {
    const iso = '2026-03-01T10:00:00Z';
    const parsed = new Date(iso);
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
    expect(formatDateOnly(iso)).toBe(expected);
    expect(formatDateOnly(null)).toBe('—');
  });

  it('formats YMD API dates without shifting the calendar day', () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(2025, 4, 15));
    expect(formatYmdAsLocalDate('2025-05-15')).toBe(expected);
    expect(formatYmdAsLocalDate(null)).toBe('—');
    expect(formatYmdAsLocalDate('not-ymd')).toBe('not-ymd');
  });

  it('localTodayYmd returns a YYYY-MM-DD string for the local calendar day', () => {
    const ymd = localTodayYmd();
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps API ISO instants to datetime-local strings and back for the API', () => {
    expect(formatIsoForDatetimeLocalInput(null)).toBe('');
    const iso = '2026-06-01T08:30:00.000Z';
    const local = formatIsoForDatetimeLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const back = parseDatetimeLocalToIsoUtc(local);
    expect(back).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns null for empty datetime-local input', () => {
    expect(parseDatetimeLocalToIsoUtc('')).toBeNull();
    expect(parseDatetimeLocalToIsoUtc('   ')).toBeNull();
  });

  it('parseDatetimeLocalToIsoUtc accepts only YYYY-MM-DDTHH:mm (rejects Z, offset, seconds)', () => {
    expect(parseDatetimeLocalToIsoUtc('2026-06-10T09:15:00.000Z')).toBeNull();
    expect(parseDatetimeLocalToIsoUtc('2026-06-10T09:15:00+08:00')).toBeNull();
    expect(parseDatetimeLocalToIsoUtc('2026-06-10T09:15:30')).toBeNull();
  });

  it('parseAdminDateTimeInputToIsoUtc accepts wall format and RFC3339 with Z', () => {
    const wall = '2026-06-10T09:15';
    expect(parseAdminDateTimeInputToIsoUtc(wall)).toBe(parseDatetimeLocalToIsoUtc(wall));
    expect(parseAdminDateTimeInputToIsoUtc('2026-06-10T09:15:00.000Z')).toMatch(/Z$/);
  });

  it('sessionSlotApiTimesToFormLocals keeps wall-clock strings and maps UTC ISO to local input', () => {
    expect(sessionSlotApiTimesToFormLocals('2026-06-15T14:30', '2026-06-15T16:30')).toEqual({
      startsAtLocal: '2026-06-15T14:30',
      endsAtLocal: '2026-06-15T16:30',
    });
    const iso = '2026-06-01T08:30:00.000Z';
    const expectedLocal = formatIsoForDatetimeLocalInput(iso);
    expect(sessionSlotApiTimesToFormLocals(iso, null).startsAtLocal).toBe(expectedLocal);
  });

  it('mapSessionSlotsFromApiToForm converts API instants to datetime-local wall strings', () => {
    const iso = '2026-06-01T08:30:00.000Z';
    const slots: SessionSlot[] = [
      {
        id: 'a',
        instanceId: 'b',
        locationId: null,
        startsAt: iso,
        endsAt: iso,
        sortOrder: 0,
      },
    ];
    const local = formatIsoForDatetimeLocalInput(iso);
    const mapped = mapSessionSlotsFromApiToForm(slots)[0];
    expect(mapped.startsAtLocal).toBe(local);
    expect(mapped.endsAtLocal).toBe(local);
  });

  it('buildSessionSlotsUtcPayload sends UTC ISO for wall-format rows and rejects offset ISO in form state', () => {
    const startsLocal = '2026-06-10T09:15';
    const endsLocal = '2026-06-10T11:15';
    const ok = buildSessionSlotsUtcPayload([
      {
        id: null,
        instanceId: null,
        locationId: null,
        startsAtLocal: startsLocal,
        endsAtLocal: endsLocal,
        sortOrder: 0,
      },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.session_slots[0].starts_at).toBe(parseDatetimeLocalToIsoUtc(startsLocal));
      expect(ok.session_slots[0].ends_at).toBe(parseDatetimeLocalToIsoUtc(endsLocal));
    }
    const bad = buildSessionSlotsUtcPayload([
      {
        id: null,
        instanceId: null,
        locationId: null,
        startsAtLocal: '2026-06-10T06:30:00.000Z',
        endsAtLocal: '2026-06-10T08:30:00.000Z',
        sortOrder: 0,
      },
    ]);
    expect(bad.ok).toBe(false);
  });

  it('buildSessionSlotsUtcPayload allows empty slot rows and rejects partial times', () => {
    const empty = buildSessionSlotsUtcPayload([
      {
        id: null,
        instanceId: null,
        locationId: null,
        startsAtLocal: null,
        endsAtLocal: null,
        sortOrder: 0,
      },
    ]);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.session_slots[0].starts_at).toBeNull();
      expect(empty.session_slots[0].ends_at).toBeNull();
    }
    const partial = buildSessionSlotsUtcPayload([
      {
        id: null,
        instanceId: null,
        locationId: null,
        startsAtLocal: '2026-06-10T09:15',
        endsAtLocal: null,
        sortOrder: 0,
      },
    ]);
    expect(partial.ok).toBe(false);
  });
});

describe('CRM party display labels', () => {
  it('formats contact name and email with interpunct when both are set', () => {
    expect(formatContactNameEmailLabel('Sam Sample', 'sam@example.com', 'id-1')).toBe(
      'Sam Sample · sam@example.com',
    );
    expect(formatContactNameEmailLabel('Sam', '', 'id-1')).toBe('Sam');
    expect(formatContactNameEmailLabel('', 'sam@example.com', 'id-1')).toBe('sam@example.com');
    expect(formatContactNameEmailLabel('', '', 'id-1')).toBe('id-1');
  });

  it('formats admin contact pickers', () => {
    expect(
      formatAdminContactPickerLabel({
        first_name: 'Sam',
        last_name: 'Sample',
        email: 'sam@example.com',
        id: 'c-1',
      }),
    ).toBe('Sam Sample · sam@example.com');
    expect(
      formatAdminContactPickerLabel({
        first_name: null,
        last_name: null,
        email: 'sole@example.com',
        id: 'c-2',
      }),
    ).toBe('sole@example.com');
  });

  it('joins first and last for formatAdminContactFullName', () => {
    expect(formatAdminContactFullName({ first_name: 'A', last_name: 'B' })).toBe('A B');
    expect(formatAdminContactFullName({ first_name: '', last_name: '' })).toBe('');
  });

  it('formats family or organisation entity · primary lines', () => {
    expect(formatFamilyOrOrganizationPartyLabel('Smith Family', 'Jane Primary')).toBe(
      'Smith Family · Jane Primary',
    );
    expect(formatFamilyOrOrganizationPartyLabel('Acme', '')).toBe('Acme');
    expect(formatFamilyOrOrganizationPartyLabel('', 'Pat')).toBe('Pat');
    expect(formatFamilyOrOrganizationPartyLabel('', '')).toBe('');
  });

  it('matches billing enrollment picker party column rules', () => {
    expect(
      formatBillingEnrollmentPartyCell({
        partyDisplayName: 'Sam Sample',
      }),
    ).toBe('Sam Sample');
    expect(
      formatBillingEnrollmentPartyCell({
        partyDisplayName: 'Sam Sample · sam@example.com',
      }),
    ).toBe('Sam Sample · sam@example.com');
    expect(
      formatBillingEnrollmentPartyCell({
        partyDisplayName: 'Smith Family · Jane',
      }),
    ).toBe('Smith Family · Jane');
    expect(formatBillingEnrollmentPartyCell({ partyDisplayName: '' })).toBe('');
  });

  it('strips a trailing email from payment Party column labels', () => {
    expect(formatPaymentPartyColumnLabel('Sam Sample · sam@example.com')).toBe('Sam Sample');
    expect(formatPaymentPartyColumnLabel('Smith Family · Jane')).toBe('Smith Family · Jane');
    expect(formatPaymentPartyColumnLabel('sam@example.com')).toBe('sam@example.com');
    expect(formatPaymentPartyColumnLabel('Pat')).toBe('Pat');
    expect(formatPaymentPartyColumnLabel('  ')).toBe('');
    expect(formatPaymentPartyColumnLabel(null)).toBe('');
  });

  it('resolves enrollment list party from API or picker maps', () => {
    const maps = {
      labelByContactId: new Map([['c1', 'A · a@x.com']]),
      labelByFamilyId: new Map([['f1', 'Fam · Primary']]),
      labelByOrganizationId: new Map([['o1', 'Org · Primary']]),
    };
    expect(
      resolveEnrollmentListPartyLabel(
        { partyDisplayName: 'From API', contactId: 'c1' },
        maps.labelByContactId,
        maps.labelByFamilyId,
        maps.labelByOrganizationId,
      ),
    ).toBe('From API');
    expect(
      resolveEnrollmentListPartyLabel(
        { contactId: 'c1' },
        maps.labelByContactId,
        maps.labelByFamilyId,
        maps.labelByOrganizationId,
      ),
    ).toBe('A · a@x.com');
    expect(
      resolveEnrollmentListPartyLabel(
        {},
        maps.labelByContactId,
        maps.labelByFamilyId,
        maps.labelByOrganizationId,
      ),
    ).toBe('—');
  });
});
