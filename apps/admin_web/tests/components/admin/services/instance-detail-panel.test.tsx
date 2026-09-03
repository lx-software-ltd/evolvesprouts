import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceDetailPanel } from '@/components/admin/services/instance-detail-panel';
import * as entityApi from '@/lib/entity-api';
import type { LocationSummary, ServiceInstance, ServiceSummary } from '@/types/services';

vi.mock('@/hooks/use-instructor-users', () => ({
  useInstructorUsers: () => ({ users: [], isLoading: false, error: '', refetch: vi.fn() }),
}));

vi.mock('@/lib/entity-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/entity-api')>('@/lib/entity-api');
  return {
    ...actual,
    listEntityPartnerOrganizationPicker: vi.fn().mockResolvedValue([]),
  };
});

function buildServiceSummary(overrides: Partial<ServiceSummary> = {}): ServiceSummary {
  return {
    id: 'service-1',
    instancesCount: 0,
    serviceType: 'training_course',
    title: 'Alpha service',
    serviceKey: null,
    bookingSystem: null,
    description: null,
    coverImageS3Key: null,
    deliveryMode: 'online',
    status: 'draft',
    createdBy: 'admin-sub',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    serviceTier: null,
    locationId: null,
    trainingDetails: null,
    eventDetails: null,
    consultationDetails: null,
    ...overrides,
  };
}

const defaultEntityTagProps = {
  entityTags: [] as import('@/lib/entity-api').EntityTagRef[],
  entityTagsLoading: false,
  entityTagsError: '',
};

function buildLocationSummary(overrides: Partial<LocationSummary> = {}): LocationSummary {
  return {
    id: 'location-1',
    name: null,
    areaId: 'area-1',
    address: 'Central Studio',
    lat: null,
    lng: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lockedFromPartnerOrg: false,
    partnerOrganizationLabels: [],
    partnerOrganizationIds: [],
    ...overrides,
  };
}

describe('InstanceDetailPanel', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });

  beforeEach(() => {
    vi.mocked(entityApi.listEntityPartnerOrganizationPicker).mockResolvedValue([]);
  });

  it('renders service and location selectors in create mode', () => {
    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId={null}
        serviceOptions={[buildServiceSummary()]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType={null}
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Service')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toBeInTheDocument();
    expect(screen.getByLabelText('Cohort')).toBeDisabled();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Waitlist')).toBeDisabled();
    // Standard editor action row: one primary button, disabled until a service is chosen.
    expect(screen.getByRole('button', { name: 'Create instance' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('routes create action with selected service id', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary()]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Create instance' }));

    expect(onCreate).toHaveBeenCalledWith(
      'service-1',
      expect.objectContaining({
        status: 'scheduled',
        partner_organization_ids: [],
        tag_ids: [],
      })
    );
  });

  it('includes selected tag ids when Tags picker is used', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <InstanceDetailPanel
        entityTags={[{ id: 'tag-alpha', name: 'Alpha', color: null }]}
        entityTagsLoading={false}
        entityTagsError=''
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary()]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByText('Tags'));
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Create instance' }));

    expect(onCreate).toHaveBeenCalledWith(
      'service-1',
      expect.objectContaining({
        tag_ids: ['tag-alpha'],
      })
    );
  });

  it('forwards service dropdown changes', async () => {
    const user = userEvent.setup();
    const onSelectService = vi.fn();

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[
          buildServiceSummary(),
          buildServiceSummary({
            id: 'service-2',
            title: 'Beta service',
            serviceType: 'consultation',
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={onSelectService}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Service'), 'service-2');

    expect(onSelectService).toHaveBeenCalledWith('service-2');
  });

  it('defaults consultation instance pricing model to package when the service has no consultation details', async () => {
    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[
          buildServiceSummary({
            serviceType: 'consultation',
            trainingDetails: null,
            consultationDetails: null,
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='consultation'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Pricing model')).toHaveValue('package');
    });
    expect(screen.getByLabelText('Pricing model')).toBeDisabled();
  });

  it('shows catalog pricing hint and read-only consultation pricing fields when the service has catalog consultation details', async () => {
    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[
          buildServiceSummary({
            serviceType: 'consultation',
            trainingDetails: null,
            consultationDetails: {
              consultationFormat: 'one_on_one',
              maxGroupSize: null,
              durationMinutes: 60,
              pricingModel: 'hourly',
              defaultHourlyRate: '200',
              defaultPackagePrice: null,
              defaultPackageSessions: null,
              defaultCurrency: 'HKD',
            },
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='consultation'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Pricing is managed on the service catalog/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Pricing model')).toBeDisabled();
    expect(screen.getByLabelText('Hourly rate')).toBeDisabled();
    expect(screen.getByLabelText('Currency')).toBeDisabled();
    expect(screen.getByLabelText('Package sessions')).toBeDisabled();
  });

  it('prefills delivery, location, and training pricing from the selected service but not title or description', async () => {
    const user = userEvent.setup();
    const onSelectService = vi.fn();

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId={null}
        serviceOptions={[
          buildServiceSummary({
            description: 'Service body',
            deliveryMode: 'hybrid',
            locationId: 'location-1',
            trainingDetails: {
              pricingUnit: 'per_family',
              defaultPrice: '199.00',
              defaultCurrency: 'USD',
            },
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType={null}
        isSaving={false}
        error=''
        onSelectService={onSelectService}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.selectOptions(screen.getByLabelText('Service'), 'service-1');

    expect(onSelectService).toHaveBeenCalledWith('service-1');
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText('Delivery mode')).toHaveValue('hybrid');
    expect(screen.getByLabelText('Pricing unit')).toHaveValue('per_family');
    expect(screen.getByLabelText('Price')).toHaveValue('199.00');
    expect(screen.getByLabelText('Currency')).toHaveValue('USD');
    expect(screen.getByLabelText('Location')).toHaveValue('location-1');
  });

  it('inherits event category from the selected service and omits category select for event instances', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='evt-svc'
        serviceOptions={[
          buildServiceSummary({
            id: 'evt-svc',
            serviceType: 'event',
            title: 'Spring open house',
            trainingDetails: null,
            eventDetails: {
              eventCategory: 'open_house',
              defaultPrice: '50.00',
              defaultCurrency: 'HKD',
            },
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='event'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Event category')).toHaveValue('Open House');
    });
    expect(screen.queryByRole('combobox', { name: 'Event category' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Instructor')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Price')).toHaveValue('50.00');
    });
    expect(screen.getByLabelText('External URL')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create instance' }));

    expect(onCreate).toHaveBeenCalledWith(
      'evt-svc',
      expect.objectContaining({
        event_ticket_tiers: [
          expect.objectContaining({
            name: 'open_house',
            price: '50.00',
            currency: 'HKD',
          }),
        ],
        partner_organization_ids: [],
        tag_ids: [],
      })
    );
  });

  it('filters instance location dropdown to pure and assigned partner venues for events', async () => {
    const user = userEvent.setup();
    vi.mocked(entityApi.listEntityPartnerOrganizationPicker).mockResolvedValue([
      { id: 'org-p', label: 'Partner P' },
      { id: 'org-x', label: 'Other partner' },
    ]);

    const pure = buildLocationSummary({ id: 'loc-pure', address: 'Pure hall' });
    const partnerVenue = buildLocationSummary({
      id: 'loc-partner',
      address: 'Shared street',
      lockedFromPartnerOrg: true,
      partnerOrganizationLabels: ['Partner P'],
      partnerOrganizationIds: ['org-p'],
    });
    const foreignVenue = buildLocationSummary({
      id: 'loc-foreign',
      address: 'Secret block',
      lockedFromPartnerOrg: true,
      partnerOrganizationLabels: ['Other partner'],
      partnerOrganizationIds: ['org-x'],
    });

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='evt-svc'
        serviceOptions={[
          buildServiceSummary({
            id: 'evt-svc',
            serviceType: 'event',
            title: 'Spring open house',
            trainingDetails: null,
            eventDetails: {
              eventCategory: 'open_house',
              defaultPrice: '50.00',
              defaultCurrency: 'HKD',
            },
          }),
        ]}
        locationOptions={[pure, partnerVenue, foreignVenue]}
        isLoadingLocations={false}
        serviceType='event'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const partnerSelect = screen.getByLabelText('Partner organisations');
    await waitFor(() => {
      expect(within(partnerSelect).getByRole('option', { name: 'Partner P' })).toBeInTheDocument();
    });
    await user.selectOptions(partnerSelect, 'org-p');

    const locationSelect = screen.getByLabelText('Location') as HTMLSelectElement;
    const optionTexts = Array.from(locationSelect.options).map((o) => o.textContent?.trim() ?? '');
    expect(optionTexts).toContain('Pure hall');
    expect(optionTexts).toContain('Partner P');
    expect(optionTexts.some((t) => t.includes('Secret'))).toBe(false);
  });

  it('prefills duplicate create from createPrefillInstance and sends suggested slug with cohort', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const prefill: ServiceInstance = {
      id: 'old-inst',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'Workshop A',
      slug: 'workshop-a',
      description: 'Body',
      coverImageS3Key: null,
      status: 'open',
      deliveryMode: 'hybrid',
      locationId: 'location-1',
      maxCapacity: 12,
      capacityLeftOverride: 4,
      capacityLeftEffective: 4,
      waitlistEnabled: true,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: 'inst-1',
      cohort: 'spring-2026',
      notes: 'Note text',
      tagIds: ['tag-1'],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: '',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [
        {
          id: 'slot-1',
          instanceId: 'old-inst',
          locationId: 'location-1',
          startsAt: '2026-06-01T10:00:00Z',
          endsAt: '2026-06-01T11:00:00Z',
          sortOrder: 0,
        },
      ],
      trainingDetails: {
        trainingFormat: 'group',
        price: '99',
        currency: 'USD',
        pricingUnit: 'per_family',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '99',
        currency: 'USD',
        pricingUnit: 'per_family',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        createPrefillInstance={prefill}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ serviceKey: 'my-course', serviceTier: '1-3' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('Workshop A');
    });
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('e.g. spring-workshop-2026-04-20'),
      ).toHaveValue('my-course-1-3-spring-2026');
    });
    expect(screen.getByLabelText('Description')).toHaveValue('Body');
    expect(screen.getByLabelText('Delivery mode')).toHaveValue('hybrid');
    expect(screen.getByLabelText('Pricing unit')).toHaveValue('per_family');
    expect(screen.getByLabelText('Price')).toHaveValue('99');
    expect(screen.getByLabelText('Currency')).toHaveValue('USD');
    expect(screen.getByLabelText('Cohort')).toHaveValue('spring-2026');
    const notes = screen.getByLabelText('Notes');
    expect(notes).toHaveValue('Note text');
    expect(notes.tagName).toBe('INPUT');

    await user.click(screen.getByRole('button', { name: 'Create instance' }));
    expect(onCreate).toHaveBeenCalledWith(
      'service-1',
      expect.objectContaining({
        slug: 'my-course-1-3-spring-2026',
        cohort: 'spring-2026',
        capacity_left_override: 4,
      })
    );
  });

  it('maps UTC session slots to local wall inputs and sends Z-suffixed instants on update', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const instance: ServiceInstance = {
      id: 'inst-utc',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'UTC slots',
      slug: 'utc-slots',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: 'online',
      locationId: 'location-1',
      maxCapacity: null,
      capacityLeftOverride: null,
      capacityLeftEffective: null,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: null,
      cohort: null,
      notes: '',
      tagIds: [],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: '',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [
        {
          id: 'slot-a',
          instanceId: 'inst-utc',
          locationId: 'location-1',
          startsAt: '2026-06-01T10:00:00Z',
          endsAt: '2026-06-01T11:00:00Z',
          sortOrder: 0,
        },
      ],
      trainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={instance}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ locationId: 'location-1' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    await user.click(screen.getByText('Session slots'));
    const startInput = await screen.findByLabelText('Start time');
    expect(startInput).toHaveValue('2026-06-01T10:00');

    await user.clear(startInput);
    await user.type(startInput, '2026-06-01T12:00');
    const endInput = screen.getByLabelText('End time');
    await user.clear(endInput);
    await user.type(endInput, '2026-06-01T14:00');

    await user.click(screen.getByRole('button', { name: 'Update instance' }));

    expect(onUpdate).toHaveBeenCalledWith(
      'service-1',
      'inst-utc',
      expect.objectContaining({
        session_slots: [
          expect.objectContaining({
            starts_at: '2026-06-01T12:00:00.000Z',
            ends_at: '2026-06-01T14:00:00.000Z',
          }),
        ],
      })
    );
  });

  it('prefills new session slot location from service default when instance venue is empty', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const venueFromService = '99999999-9999-9999-9999-999999999999';

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[
          buildServiceSummary({
            locationId: venueFromService,
          }),
        ]}
        locationOptions={[
          buildLocationSummary({
            id: venueFromService,
            name: 'Service default venue',
          }),
        ]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByText('Session slots'));
    await user.click(screen.getByRole('button', { name: /add slot/i }));
    const startInput = screen.getByLabelText('Start time');
    await user.type(startInput, '2026-08-20T09:00');

    const locationSelects = screen.getAllByLabelText('Location');
    const slotLocationSelect = locationSelects.find((el) => el.id === 'slot-0-location');
    expect(slotLocationSelect).toBeDefined();
    expect(slotLocationSelect).toHaveValue(venueFromService);

    await user.click(screen.getByRole('button', { name: 'Create instance' }));
    expect(onCreate).toHaveBeenCalledWith(
      'service-1',
      expect.objectContaining({
        session_slots: [
          expect.objectContaining({
            location_id: venueFromService,
            starts_at: '2026-08-20T09:00:00.000Z',
            ends_at: '2026-08-20T11:00:00.000Z',
          }),
        ],
      })
    );
  });

  it('auto-updates training_course create slug from service slug, tier, and cohort until slug is edited', async () => {
    const user = userEvent.setup();
    const venueId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const { rerender } = render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='svc-1'
        serviceOptions={[
          buildServiceSummary({
            id: 'svc-1',
            title: 'Training',
            serviceKey: 'training-template',
            serviceTier: null,
          }),
        ]}
        locationOptions={[buildLocationSummary({ id: venueId })]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('e.g. spring-workshop-2026-04-20'),
      ).toHaveValue('training-template');
    });

    rerender(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='svc-1'
        serviceOptions={[
          buildServiceSummary({
            id: 'svc-1',
            title: 'Training',
            serviceKey: 'bla-bla-bla',
            serviceTier: '1-3',
          }),
        ]}
        locationOptions={[buildLocationSummary({ id: venueId })]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const slugInput = screen.getByPlaceholderText(
      'e.g. spring-workshop-2026-04-20',
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(slugInput).toHaveValue('bla-bla-bla-1-3');
    });

    await user.type(screen.getByLabelText('Cohort'), 'may-26');
    await waitFor(() => {
      expect(slugInput).toHaveValue('bla-bla-bla-1-3-may-26');
    });

    await user.clear(screen.getByLabelText('Cohort'));
    await waitFor(() => {
      expect(slugInput).toHaveValue('bla-bla-bla-1-3');
    });
  });

  it('auto-populates event slug from title and first session slot date until slug is edited', async () => {
    const user = userEvent.setup();

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='evt-svc'
        serviceOptions={[
          buildServiceSummary({
            id: 'evt-svc',
            serviceType: 'event',
            title: 'Events',
            serviceKey: 'events',
            trainingDetails: null,
            eventDetails: {
              eventCategory: 'open_house',
              defaultPrice: '10',
              defaultCurrency: 'HKD',
            },
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='event'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const slugInput = screen.getByPlaceholderText(
      'e.g. spring-workshop-2026-04-20',
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(slugInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    await user.click(screen.getByText('Session slots'));
    await user.click(screen.getByRole('button', { name: /add slot/i }));
    const startInput = screen.getByLabelText('Start time');
    await user.clear(startInput);
    await user.type(startInput, '2026-04-20T14:00');

    await waitFor(() => {
      expect(slugInput.value.endsWith('2026-04-20')).toBe(true);
    });

    await user.type(screen.getByLabelText('Title'), 'Spring Gala');
    await waitFor(() => {
      expect(slugInput.value).toBe('spring-gala-2026-04-20');
    });

    await user.clear(slugInput);
    await user.type(slugInput, 'custom-slug');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Ignored');
    expect(slugInput).toHaveValue('custom-slug');
  });

  it('shows inline error when event slug is empty on add', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='evt-svc-2'
        serviceOptions={[
          buildServiceSummary({
            id: 'evt-svc-2',
            serviceType: 'event',
            title: 'Events',
            serviceKey: 'events',
            trainingDetails: null,
            eventDetails: {
              eventCategory: 'open_house',
              defaultPrice: '25',
              defaultCurrency: 'HKD',
            },
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='event'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    const slugInput = screen.getByPlaceholderText('e.g. spring-workshop-2026-04-20');
    await waitFor(() => {
      expect((slugInput as HTMLInputElement).value.length).toBeGreaterThan(0);
    });
    await user.type(slugInput, '-manual');
    await user.clear(slugInput);
    await waitFor(() => {
      expect(slugInput).toHaveValue('');
    });
    await user.click(screen.getByRole('button', { name: 'Create instance' }));
    expect(
      screen.getByText(/^slug is required$/i),
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('requires slug for consultation create', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={null}
        selectedServiceId='service-1'
        serviceOptions={[
          buildServiceSummary({
            serviceType: 'consultation',
            trainingDetails: null,
            consultationDetails: null,
          }),
        ]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='consultation'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={onCreate}
        onUpdate={vi.fn()}
      />
    );

    const slugInput = screen.getByPlaceholderText(
      'e.g. spring-workshop-2026-04-20',
    ) as HTMLInputElement;

    await user.type(slugInput, 'consultation-instance-1');
    await user.click(screen.getByRole('button', { name: 'Create instance' }));
    expect(onCreate).toHaveBeenCalledWith(
      'service-1',
      expect.objectContaining({ slug: 'consultation-instance-1' }),
    );
    const payload = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('consultation_details');
  });

  it('disables capacity left override when max capacity is unset', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const instance: ServiceInstance = {
      id: 'inst-unlim',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'No cap',
      slug: 'no-cap',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: 'online',
      locationId: 'location-1',
      maxCapacity: null,
      capacityLeftOverride: 3,
      capacityLeftEffective: null,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: null,
      cohort: null,
      notes: '',
      tagIds: [],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: 'no-cap',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [
        {
          id: 'slot-a',
          instanceId: 'inst-unlim',
          locationId: 'location-1',
          startsAt: '2026-06-01T10:00:00Z',
          endsAt: '2026-06-01T11:00:00Z',
          sortOrder: 0,
        },
      ],
      trainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={instance}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ locationId: 'location-1' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    const overrideInput = screen.getByLabelText('Capacity left override');
    expect(overrideInput).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Update instance' }));
    const payload = onUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.capacity_left_override).toBeNull();
  });

  it('sends capacity_left_override null when max capacity is cleared on update', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const instance: ServiceInstance = {
      id: 'inst-clear-max',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'Capped then unlimited',
      slug: 'capped-then-unlim',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: 'online',
      locationId: 'location-1',
      maxCapacity: 10,
      capacityLeftOverride: 5,
      capacityLeftEffective: 5,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: null,
      cohort: null,
      notes: '',
      tagIds: [],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: 'capped-then-unlim',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [
        {
          id: 'slot-a',
          instanceId: 'inst-clear-max',
          locationId: 'location-1',
          startsAt: '2026-06-01T10:00:00Z',
          endsAt: '2026-06-01T11:00:00Z',
          sortOrder: 0,
        },
      ],
      trainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={instance}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ locationId: 'location-1' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    const maxInput = screen.getByLabelText('Max capacity');
    await user.click(maxInput);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(maxInput).toHaveValue(null);

    await user.click(screen.getByRole('button', { name: 'Update instance' }));
    const payload = onUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.max_capacity).toBeNull();
    expect(payload.capacity_left_override).toBeNull();
  });

  it('sends capacity_left_override null when override field is cleared on update', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const instance: ServiceInstance = {
      id: 'inst-ov',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'Capped',
      slug: 'capped-inst',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: 'online',
      locationId: 'location-1',
      maxCapacity: 10,
      capacityLeftOverride: 2,
      capacityLeftEffective: 2,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'pending',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: null,
      cohort: null,
      notes: '',
      tagIds: [],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: 'capped-inst',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [
        {
          id: 'slot-a',
          instanceId: 'inst-ov',
          locationId: 'location-1',
          startsAt: '2026-06-01T10:00:00Z',
          endsAt: '2026-06-01T11:00:00Z',
          sortOrder: 0,
        },
      ],
      trainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={instance}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ locationId: 'location-1' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />
    );

    const overrideInput = document.getElementById('instance-capacity-left-override') as HTMLInputElement;
    expect(overrideInput).toBeTruthy();
    expect(overrideInput.disabled).toBe(false);
    await user.click(overrideInput);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(overrideInput.value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Update instance' }));
    const payload = onUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(payload.capacity_left_override).toBeNull();
  });

  it('shows Eventbrite sync status as a read-only field when editing an instance', () => {
    const instance: ServiceInstance = {
      id: 'inst-eb',
      serviceId: 'service-1',
      parentServiceTitle: null,
      parentServiceTier: null,
      parentServiceKey: null,
      parentServiceType: 'training_course',
      title: 'EB status',
      slug: 'eb-status',
      description: null,
      coverImageS3Key: null,
      status: 'scheduled',
      deliveryMode: 'online',
      locationId: 'location-1',
      maxCapacity: null,
      capacityLeftOverride: null,
      capacityLeftEffective: null,
      waitlistEnabled: false,
      eventbriteSyncStatus: 'failed',
      externalUrl: null,
      partnerOrganizations: [],
      instructorId: null,
      cohort: null,
      notes: '',
      tagIds: [],
      createdBy: 'admin',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      resolvedTitle: null,
      resolvedSlug: 'eb-status',
      resolvedDescription: null,
      resolvedCoverImageS3Key: null,
      resolvedDeliveryMode: null,
      resolvedLocationId: 'location-1',
      sessionSlots: [],
      trainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      resolvedTrainingDetails: {
        trainingFormat: 'group',
        price: '50',
        currency: 'HKD',
        pricingUnit: 'per_person',
      },
      eventTicketTiers: [],
      resolvedEventTicketTiers: [],
      consultationDetails: null,
      resolvedConsultationDetails: null,
    };

    render(
      <InstanceDetailPanel
        {...defaultEntityTagProps}
        instance={instance}
        selectedServiceId='service-1'
        serviceOptions={[buildServiceSummary({ locationId: 'location-1' })]}
        locationOptions={[buildLocationSummary()]}
        isLoadingLocations={false}
        serviceType='training_course'
        isSaving={false}
        error=''
        onSelectService={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const eventbrite = screen.getByLabelText('Eventbrite');
    expect(eventbrite).toHaveValue('Failed');
    expect(eventbrite).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Update instance' })).toBeInTheDocument();
  });
});
