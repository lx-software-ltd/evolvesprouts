import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServicesView } from '@/hooks/use-services-page';
import type { ServiceDetail, ServiceInstance, ServiceSummary } from '@/types/services';

import { makeExpanded } from '../../../fixtures/expanded-record';

const SERVICE_ROW: ServiceSummary = {
  id: 'service-1',
  instancesCount: 1,
  serviceType: 'training_course',
  title: 'Yoga',
  serviceKey: 'yoga',
  bookingSystem: null,
  description: null,
  coverImageS3Key: null,
  deliveryMode: 'in_person',
  status: 'published',
  serviceTier: null,
  locationId: null,
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  trainingDetails: null,
  eventDetails: null,
  consultationDetails: null,
};

const SERVICE_DETAIL: ServiceDetail = {
  ...SERVICE_ROW,
  tagIds: [],
  assetIds: [],
  trainingDetails: { pricingUnit: 'per_person', defaultPrice: null, defaultCurrency: null },
};

const INSTANCE_ROW: ServiceInstance = {
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
  maxCapacity: 10,
  capacityEnrolledCount: 3,
  capacityLeftOverride: null,
  capacityLeftEffective: 7,
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

const { mockUseServicesPage, state } = vi.hoisted(() => {
  const shell = () => ({
    markDirty: vi.fn(),
    clearDirty: vi.fn(),
  });
  const state = {
    activeView: 'catalog' as ServicesView,
    setActiveView: vi.fn(),
    entityTags: [],
    entityTagsLoading: false,
    entityTagsError: '',
    serviceList: {
      services: [] as ServiceSummary[],
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
    locationList: {
      locations: [],
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    catalog: {
      shell: shell(),
      expanded: null as unknown,
      discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
      selectedId: null as string | null,
      detail: {
        service: null as ServiceDetail | null,
        isLoading: false,
        error: '',
        refetch: vi.fn().mockResolvedValue(undefined),
      },
      pinnedService: null,
      mutations: {
        isLoading: false,
        error: '',
        createServiceEntry: vi.fn().mockResolvedValue(null),
        updateServiceEntry: vi.fn().mockResolvedValue(null),
        deleteServiceEntry: vi.fn().mockResolvedValue(undefined),
        createCoverImageUpload: vi.fn().mockResolvedValue(undefined),
      },
      duplicateTemplate: null,
      clearDuplicateTemplate: vi.fn(),
      duplicateService: vi.fn().mockResolvedValue(true),
    },
    instances: {
      filters: {
        service: '',
        setService: vi.fn(),
        serviceType: '',
        setServiceType: vi.fn(),
        status: 'not_completed' as const,
        setStatus: vi.fn(),
        search: '',
        setSearch: vi.fn(),
      },
      list: {
        instances: [] as ServiceInstance[],
        isLoading: false,
        isLoadingMore: false,
        error: '',
        refetch: vi.fn().mockResolvedValue(undefined),
        loadMore: vi.fn().mockResolvedValue(undefined),
        hasMore: false,
        totalCount: 0,
      },
      rows: [] as ServiceInstance[],
      pinnedInstance: null as ServiceInstance | null,
      shell: shell(),
      expanded: null as unknown,
      discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
      selectedId: null as string | null,
      draftServiceId: null as string | null,
      setDraftServiceId: vi.fn(),
      mutations: {
        isLoading: false,
        error: '',
        createInstanceEntry: vi.fn().mockResolvedValue(null),
        updateInstanceEntry: vi.fn().mockResolvedValue(null),
        deleteInstanceEntry: vi.fn().mockResolvedValue(undefined),
      },
      optionsCacheVersion: 0,
      duplicateTemplate: null,
      clearDuplicateTemplate: vi.fn(),
      duplicateInstance: vi.fn().mockResolvedValue(true),
      refetchList: vi.fn().mockResolvedValue(undefined),
    },
    discountCodes: {
      codes: [],
      filters: { active: '', search: '', scope: '' },
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

vi.mock('@/hooks/use-partners', () => ({
  usePartners: () => ({
    partners: [],
    filters: { query: '', active: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    totalCount: 0,
    isSaving: false,
    createPartner: vi.fn(),
    updatePartner: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    updateMember: vi.fn(),
    deletePartner: vi.fn(),
    refetch: vi.fn(),
    relationshipOptions: ['partner'] as const,
  }),
}));

vi.mock('@/hooks/use-completion-certificates', () => ({
  useCompletionCertificates: () => ({
    certificates: [],
    filters: {},
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    loadMore: vi.fn(),
    refetch: vi.fn(),
    isSaving: false,
    createCertificate: vi.fn(),
    voidCertificate: vi.fn(),
  }),
}));

vi.mock('@/components/admin/services/partners-panel', () => ({
  PartnersPanel: () => <div data-testid='partners-tab-mock'>Partners</div>,
}));

vi.mock('@/components/admin/services/certificates-panel', () => ({
  CertificatesPanel: () => <div data-testid='certificates-tab-mock'>Certificates</div>,
}));

vi.mock('@/components/admin/services/service-detail-panel', () => ({
  ServiceDetailPanel: (props: { mode: string; service: ServiceDetail | null; createPrefillFromService?: unknown }) => (
    <div data-testid='service-editor' data-mode={props.mode} data-service-id={props.service?.id ?? ''}>
      service editor
    </div>
  ),
}));

vi.mock('@/components/admin/services/instance-detail-panel', () => ({
  InstanceDetailPanel: (props: {
    instance: ServiceInstance | null;
    selectedServiceId: string | null;
    enrollmentsCount?: number | null;
    enrollments?: unknown;
  }) => (
    <div
      data-testid='instance-editor'
      data-mode={props.instance ? 'edit' : 'create'}
      data-instance-id={props.instance?.id ?? ''}
      data-service-id={props.selectedServiceId ?? ''}
      data-enrollments-count={props.enrollmentsCount ?? ''}
      data-has-enrollments={props.enrollments !== undefined ? 'true' : 'false'}
    >
      instance editor
    </div>
  ),
}));

import { ServicesPage } from '@/components/admin/services/services-page';

describe('ServicesPage', () => {
  beforeEach(() => {
    state.activeView = 'catalog';
    state.serviceList.services = [SERVICE_ROW];
    state.catalog.expanded = makeExpanded();
    state.catalog.selectedId = null;
    state.catalog.detail.service = null;
    state.catalog.detail.error = '';
    state.instances.expanded = makeExpanded();
    state.instances.selectedId = null;
    state.instances.rows = [INSTANCE_ROW];
    state.instances.list.instances = [INSTANCE_ROW];
    state.instances.filters.search = '';
    state.instances.filters.status = 'not_completed';
  });

  it('renders tabs-only header and switches views', async () => {
    const user = userEvent.setup();
    render(<ServicesPage />);

    expect(screen.getByRole('button', { name: 'Service Catalogue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
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

  it('renders the catalogue as a table-first block: filters and New service above the table, no editor card', () => {
    render(<ServicesPage />);

    const region = screen.getByRole('region', { name: 'Services' });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const filterBar = within(region).getByTestId('admin-filter-bar');
    const table = within(region).getByRole('table');
    expect(filterBar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(filterBar).getByRole('button', { name: 'New service' })).toBeInTheDocument();
    expect(screen.queryByTestId('service-editor')).not.toBeInTheDocument();
    expect(within(table).getByText('Yoga')).toBeInTheDocument();
  });

  it('shows the editor skeleton in the expanded service row until the detail arrives, then the edit editor', () => {
    state.catalog.expanded = makeExpanded({ expandedId: 'service-1', isExpanded: (id) => id === 'service-1' });
    state.catalog.selectedId = 'service-1';

    const { rerender } = render(<ServicesPage />);
    expect(screen.getByTestId('admin-editor-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('service-editor')).not.toBeInTheDocument();

    state.catalog.detail.service = SERVICE_DETAIL;
    rerender(<ServicesPage />);
    expect(screen.queryByTestId('admin-editor-skeleton')).not.toBeInTheDocument();
    const editor = screen.getByTestId('service-editor');
    expect(editor).toHaveAttribute('data-mode', 'edit');
    expect(editor).toHaveAttribute('data-service-id', 'service-1');
  });

  it('renders the create editor inside the draft service row', () => {
    state.catalog.expanded = makeExpanded({ expandedId: 'new', isDraftOpen: true });
    render(<ServicesPage />);
    expect(screen.getByTestId('service-editor')).toHaveAttribute('data-mode', 'create');
  });

  it('renders Instances as a table-first block with one-line filters and New instance', () => {
    state.activeView = 'instances';
    render(<ServicesPage />);

    const region = screen.getByRole('region', { name: 'Instances' });
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const filterBar = within(region).getByTestId('admin-filter-bar');
    expect(within(filterBar).getByRole('button', { name: 'New instance' })).toBeInTheDocument();
    expect(within(filterBar).getByLabelText('Search')).toBeInTheDocument();
    expect(within(filterBar).getByLabelText('Type')).toBeInTheDocument();
    expect(within(filterBar).getByLabelText('Status')).toBeInTheDocument();
    expect(within(filterBar).getByLabelText('Service')).toBeInTheDocument();
    expect(within(filterBar).queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    expect(within(region).getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('instance-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Enrollments' })).not.toBeInTheDocument();
  });

  it('wires instances filter changes immediately to the section hook', async () => {
    const user = userEvent.setup();
    state.activeView = 'instances';
    render(<ServicesPage />);

    await user.type(screen.getByLabelText('Search'), 'y');
    expect(state.instances.filters.setSearch).toHaveBeenCalledWith('y');
    await user.selectOptions(screen.getByLabelText('Status'), 'completed');
    expect(state.instances.filters.setStatus).toHaveBeenCalledWith('completed');
    await user.selectOptions(screen.getByLabelText('Service'), 'service-1');
    expect(state.instances.filters.setService).toHaveBeenCalledWith('service-1');
  });

  it('renders the instance editor in place with the enrollments section wired for saved rows', () => {
    state.activeView = 'instances';
    state.instances.expanded = makeExpanded({ expandedId: 'instance-1', isExpanded: (id) => id === 'instance-1' });
    state.instances.selectedId = 'instance-1';
    render(<ServicesPage />);

    const editor = screen.getByTestId('instance-editor');
    expect(editor).toHaveAttribute('data-mode', 'edit');
    expect(editor).toHaveAttribute('data-instance-id', 'instance-1');
    expect(editor).toHaveAttribute('data-service-id', 'service-1');
    expect(editor).toHaveAttribute('data-enrollments-count', '3');
    expect(editor).toHaveAttribute('data-has-enrollments', 'true');
  });

  it('renders the create editor in the draft instance row using the draft service', () => {
    state.activeView = 'instances';
    state.instances.expanded = makeExpanded({ expandedId: 'new', isDraftOpen: true });
    state.instances.draftServiceId = 'service-1';
    render(<ServicesPage />);

    const editor = screen.getByTestId('instance-editor');
    expect(editor).toHaveAttribute('data-mode', 'create');
    expect(editor).toHaveAttribute('data-service-id', 'service-1');
    expect(editor).toHaveAttribute('data-has-enrollments', 'false');
  });

  it('surfaces list and mutation errors in the page banner', () => {
    state.catalog.detail.error = 'Failed to load service detail.';
    render(<ServicesPage />);
    expect(screen.getByText('Failed to load service detail.')).toBeInTheDocument();
  });
});
