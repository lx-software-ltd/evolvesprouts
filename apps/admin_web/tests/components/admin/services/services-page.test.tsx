import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServicesView } from '@/hooks/use-services-page';
import type { ServiceInstance } from '@/types/services';

const { mockUseServicesPage, state } = vi.hoisted(() => {
  const state = {
    activeView: 'catalog' as ServicesView,
    setActiveView: vi.fn(),
    selectedServiceId: null as string | null,
    setSelectedServiceId: vi.fn(),
    selectedService: null,
    selectedInstanceId: null as string | null,
    setSelectedInstanceId: vi.fn(),
    selectedInstance: null,
    instancesServiceFilter: '',
    setInstancesServiceFilter: vi.fn(),
    instancesServiceTypeFilter: '',
    setInstancesServiceTypeFilter: vi.fn(),
    instancesStatusFilter: 'not_completed' as const,
    setInstancesStatusFilter: vi.fn(),
    instancesSearchQuery: '',
    setInstancesSearchQuery: vi.fn(),
    entityTags: [],
    entityTagsLoading: false,
    entityTagsError: '',
    serviceList: {
      services: [],
      filters: { serviceType: '', status: 'published', search: '' },
      setFilter: vi.fn(),
      clearFilters: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      totalCount: 0,
    },
    serviceDetail: {
      service: null,
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    serviceMutations: {
      isLoading: false,
      error: '',
      createServiceEntry: vi.fn().mockResolvedValue(null),
      updateServiceEntry: vi.fn().mockResolvedValue(null),
      deleteServiceEntry: vi.fn().mockResolvedValue(undefined),
      createCoverImageUpload: vi.fn().mockResolvedValue(undefined),
    },
    instanceList: {
      instances: [] as ServiceInstance[],
      filters: { status: '' },
      setFilter: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      totalCount: 0,
    },
    instanceMutations: {
      isLoading: false,
      error: '',
      createInstanceEntry: vi.fn().mockResolvedValue(null),
      updateInstanceEntry: vi.fn().mockResolvedValue(null),
      deleteInstanceEntry: vi.fn().mockResolvedValue(undefined),
    },
    enrollmentList: {
      enrollments: [],
      filters: { status: '' },
      setFilter: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      totalCount: 0,
    },
    enrollmentMutations: {
      isLoading: false,
      error: '',
      createEnrollmentEntry: vi.fn().mockResolvedValue(null),
      updateEnrollmentEntry: vi.fn().mockResolvedValue(null),
      deleteEnrollmentEntry: vi.fn().mockResolvedValue(undefined),
    },
    locationList: {
      locations: [],
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    discountCodes: {
      codes: [],
      filters: { active: '', search: '' },
      setFilter: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      isSaving: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      totalCount: 0,
      createCode: vi.fn().mockResolvedValue(null),
      updateCode: vi.fn().mockResolvedValue(null),
      deleteCode: vi.fn().mockResolvedValue(undefined),
    },
    venues: {
      venues: [],
      geographicAreas: [],
      areasLoading: false,
      filters: { areaId: '', search: '' },
      setFilter: vi.fn(),
      isLoading: false,
      isLoadingMore: false,
      isSaving: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      totalCount: 0,
      createVenue: vi.fn().mockResolvedValue(null),
      updateVenue: vi.fn().mockResolvedValue(null),
      updateVenuePartial: vi.fn().mockResolvedValue(null),
      deleteVenue: vi.fn().mockResolvedValue(undefined),
    },
    contactFilterId: '',
    familyFilterId: '',
    organizationFilterId: '',
  };
  return {
    state,
    mockUseServicesPage: vi.fn(() => state),
  };
});

vi.mock('@/hooks/use-services-page', () => ({
  useServicesPage: mockUseServicesPage,
}));

vi.mock('@/components/admin/services/partners-tab', () => ({
  PartnersTab: () => <div data-testid='partners-tab-mock'>Partners</div>,
}));

vi.mock('@/components/admin/services/certificates-tab', () => ({
  CertificatesTab: () => <div data-testid='certificates-tab-mock'>Certificates</div>,
}));

import { ServicesPage } from '@/components/admin/services/services-page';

const INSTANCE_FOR_SEARCH: ServiceInstance = {
  id: 'instance-search-1',
  serviceId: 'service-1',
  parentServiceTitle: 'Yoga',
  parentServiceTier: null,
  parentServiceKey: null,
  parentServiceType: 'training_course',
  title: null,
  slug: 'instance-search-1',
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
  resolvedSlug: 'instance-search-1',
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

describe('ServicesPage', () => {
  beforeEach(() => {
    state.activeView = 'catalog';
    state.instanceList.instances = [];
    state.instancesSearchQuery = '';
    state.instancesStatusFilter = 'not_completed';
  });

  it('renders tabs-only header and switches views', async () => {
    const user = userEvent.setup();
    render(<ServicesPage />);

    expect(screen.getByRole('button', { name: 'Service Catalogue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New service' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Instances' }));
    expect(state.setActiveView).toHaveBeenCalledWith('instances');
    await user.click(screen.getByRole('button', { name: 'Discount Codes' }));
    expect(state.setActiveView).toHaveBeenCalledWith('discount-codes');
    await user.click(screen.getByRole('button', { name: 'Venues' }));
    expect(state.setActiveView).toHaveBeenCalledWith('venues');
    await user.click(screen.getByRole('button', { name: 'Partners' }));
    expect(state.setActiveView).toHaveBeenCalledWith('partners');
  });

  it('renders Certificates panel when active view is certificates', () => {
    state.activeView = 'certificates';
    render(<ServicesPage />);
    expect(screen.getByTestId('certificates-tab-mock')).toBeInTheDocument();
  });

  it('renders Partners panel when active view is partners', () => {
    state.activeView = 'partners';
    render(<ServicesPage />);
    expect(screen.getByTestId('partners-tab-mock')).toBeInTheDocument();
  });

  it('renders service detail before the services list', () => {
    render(<ServicesPage />);

    const detailHeading = screen.getByRole('heading', { name: 'Service' });
    const listHeading = screen.getByRole('heading', { name: 'Services' });

    expect(detailHeading.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders instance detail before the instances list on Instances', () => {
    state.activeView = 'instances';
    render(<ServicesPage />);

    const detailHeading = screen.getByRole('heading', { name: 'Instance' });
    const listHeading = screen.getByRole('heading', { name: 'Instances' });

    expect(detailHeading.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('wires instances search input changes on Instances', async () => {
    const user = userEvent.setup();
    state.activeView = 'instances';
    render(<ServicesPage />);

    await user.type(screen.getByLabelText('Search instances'), 'yoga');

    expect(state.setInstancesSearchQuery).toHaveBeenCalled();
  });

  it('wires instances status filter changes on Instances', async () => {
    const user = userEvent.setup();
    state.activeView = 'instances';
    render(<ServicesPage />);

    await user.selectOptions(screen.getByLabelText('Instance statuses'), 'completed');

    expect(state.setInstancesStatusFilter).toHaveBeenCalledWith('completed');
  });

  it('filters instances to non-completed rows when status filter is Not Completed', () => {
    state.activeView = 'instances';
    state.instancesStatusFilter = 'not_completed';
    state.instanceList.instances = [
      {
        ...INSTANCE_FOR_SEARCH,
        id: 'inst-open',
        status: 'open',
        parentServiceTitle: 'Alpha Service',
      },
      {
        ...INSTANCE_FOR_SEARCH,
        id: 'inst-done',
        status: 'completed',
        parentServiceTitle: 'Beta Service',
      },
    ];

    render(<ServicesPage />);

    expect(screen.getByText('Alpha Service')).toBeInTheDocument();
    expect(screen.queryByText('Beta Service')).not.toBeInTheDocument();
  });

  it('filters instances by cohort using the raw stored value only', () => {
    state.activeView = 'instances';
    state.instanceList.instances = [INSTANCE_FOR_SEARCH];

    state.instancesSearchQuery = 'spring 2024';
    const { rerender, unmount } = render(<ServicesPage />);
    expect(screen.queryByText('spring-2024')).not.toBeInTheDocument();

    state.instancesSearchQuery = 'spring-2024';
    rerender(<ServicesPage />);
    expect(screen.getByText('Yoga')).toBeInTheDocument();
    expect(screen.getAllByText('spring-2024').length).toBeGreaterThanOrEqual(1);

    unmount();
  });
});
