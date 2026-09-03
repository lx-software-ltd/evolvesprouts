import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DiscountCodesPanel } from '@/components/admin/services/discount-codes-panel';
import { InstanceListPanel } from '@/components/admin/services/instance-list-panel';
import { ServiceListPanel } from '@/components/admin/services/service-list-panel';
import { formatDate } from '@/lib/format';
import { formatAmountInCurrency } from '@/lib/vendor-spend';
import type { DiscountCode, ServiceInstance, ServiceSummary } from '@/types/services';

import { makeExpanded } from '../../../fixtures/expanded-record';

vi.mock('@/lib/services-api', () => ({
  isAbortRequestError: () => false,
  listEnrollmentDiscountOptions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/hooks/use-enrollment-parent-pickers', () => ({
  useEnrollmentParentPickers: () => ({
    contactOptions: [{ id: 'contact-1', label: 'Resolved contact label' }],
    families: [],
    organizations: [],
    partnerOrganizations: [],
    loading: false,
    error: '',
    labelByContactId: new Map([['contact-1', 'Resolved contact label']]),
    labelByFamilyId: new Map(),
    labelByOrganizationId: new Map(),
    labelByPartnerOrganizationId: new Map(),
  }),
}));

const SERVICE_FIXTURE: ServiceSummary = {
  id: 'service-1',
  instancesCount: 0,
  serviceType: 'training_course',
  title: 'Service title',
  serviceKey: null,
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

const INSTANCE_FIXTURE: ServiceInstance = {
  id: 'instance-1',
  serviceId: 'service-1',
  parentServiceTitle: null,
  parentServiceTier: null,
  parentServiceType: null,
  parentServiceKey: null,
  title: null,
  slug: 'instance-one',
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
  resolvedTitle: 'Resolved title',
  cohort: 'spring-2024',
  resolvedSlug: 'instance-one',
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

const DISCOUNT_CODE_FIXTURE: DiscountCode = {
  id: 'discount-1',
  code: 'SAVE10',
  description: null,
  discountType: 'percentage',
  discountValue: '10',
  currency: 'HKD',
  validFrom: null,
  validUntil: null,
  serviceId: null,
  instanceId: null,
  maxUses: null,
  currentUses: 0,
  active: true,
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
};

const DISCOUNT_REFERRAL_FIXTURE: DiscountCode = {
  ...DISCOUNT_CODE_FIXTURE,
  id: 'discount-ref',
  code: 'TRACK',
  discountType: 'referral',
  discountValue: '0',
};

describe('services tables value formatting', () => {
  it('formats enum values in service list table rows', () => {
    render(
      <ServiceListPanel
        services={[SERVICE_FIXTURE]}
        expanded={makeExpanded()}
        draftDetail={null}
        renderDetail={() => null}
        filters={{ serviceType: '', status: '', search: '' }}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onFilterChange={vi.fn()}
        onLoadMore={vi.fn()}
        onDuplicateService={vi.fn()}
        onDeleteService={vi.fn()}
      />
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Training Course')).toBeInTheDocument();
    expect(within(table).getByText('Published')).toBeInTheDocument();
    expect(within(table).getByText('In Person')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Tier column after Title with tier value or em dash', () => {
    const withTier: ServiceSummary = { ...SERVICE_FIXTURE, serviceTier: 'cohort-a' };
    render(
      <ServiceListPanel
        services={[withTier]}
        expanded={makeExpanded()}
        draftDetail={null}
        renderDetail={() => null}
        filters={{ serviceType: '', status: '', search: '' }}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onFilterChange={vi.fn()}
        onLoadMore={vi.fn()}
        onDuplicateService={vi.fn()}
        onDeleteService={vi.fn()}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((el) => el.textContent?.trim())).toEqual([
      '',
      'Title',
      'Tier',
      'Type',
      'Price',
      'Status',
      'Delivery',
      'Operations',
    ]);

    const table = screen.getByRole('table');
    const dataRow = screen.getByText('Service title').closest('tr');
    expect(dataRow).toBeTruthy();
    expect(within(dataRow as HTMLElement).getByText('cohort-a')).toBeInTheDocument();
    expect(within(dataRow as HTMLElement).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('disables delete when the service has instances', () => {
    const withInstances: ServiceSummary = { ...SERVICE_FIXTURE, instancesCount: 2 };
    render(
      <ServiceListPanel
        services={[withInstances]}
        expanded={makeExpanded()}
        draftDetail={null}
        renderDetail={() => null}
        filters={{ serviceType: '', status: '', search: '' }}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onFilterChange={vi.fn()}
        onLoadMore={vi.fn()}
        onDuplicateService={vi.fn()}
        onDeleteService={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /cannot delete service while it has instances/i })).toBeDisabled();
  });

  it('formats values in instance and discount tables', () => {
    render(
      <>
        <InstanceListPanel
          instances={[
            {
              ...INSTANCE_FIXTURE,
              title: 'Custom instance title',
            },
          ]}
          expanded={makeExpanded()}
          draftDetail={null}
          renderDetail={() => null}
          isLoading={false}
          isLoadingMore={false}
          hasMore={false}
          error=''
          isMutating={false}
          onLoadMore={vi.fn()}
          onDuplicateInstance={vi.fn()}
          onDeleteInstance={vi.fn()}
          serviceFilter={{ value: '', options: [], onChange: vi.fn() }}
          serviceTypeFilter={{ value: '', onChange: vi.fn() }}
          statusFilter={{ value: '', onChange: vi.fn() }}
          searchFilter={{ value: '', onChange: vi.fn() }}
        />
        <DiscountCodesPanel
          codes={[DISCOUNT_CODE_FIXTURE, DISCOUNT_REFERRAL_FIXTURE]}
          filters={{ active: '', search: '', scope: '' }}
          isLoading={false}
          isLoadingMore={false}
          isSaving={false}
          hasMore={false}
          error=''
          serviceOptions={[SERVICE_FIXTURE]}
          onFilterChange={vi.fn()}
          onLoadMore={vi.fn()}
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />
      </>
    );

    const tables = screen.getAllByRole('table');
    const instanceTable = tables[0] as HTMLElement;
    expect(within(instanceTable).getByText('Custom instance title')).toBeInTheDocument();
    expect(within(instanceTable).getByText('spring-2024')).toBeInTheDocument();
    expect(within(instanceTable).getByText('Unlimited')).toBeInTheDocument();
    expect(within(tables[1] as HTMLElement).getByText('SAVE10')).toBeInTheDocument();
    expect(within(tables[1] as HTMLElement).getByText('10%')).toBeInTheDocument();
    expect(within(tables[1] as HTMLElement).getByText('Referral')).toBeInTheDocument();
  });

  it('shows instance capacity as seats left over max in instances table', () => {
    render(
      <InstanceListPanel
        instances={[
          {
            ...INSTANCE_FIXTURE,
            title: 'Capped',
            maxCapacity: 8,
            capacityEnrolledCount: 2,
            status: 'open',
          },
        ]}
        expanded={makeExpanded()}
        draftDetail={null}
        renderDetail={() => null}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onDuplicateInstance={vi.fn()}
        onDeleteInstance={vi.fn()}
        serviceFilter={{ value: '', options: [], onChange: vi.fn() }}
        serviceTypeFilter={{ value: '', onChange: vi.fn() }}
        statusFilter={{ value: '', onChange: vi.fn() }}
        searchFilter={{ value: '', onChange: vi.fn() }}
      />
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('6/8')).toBeInTheDocument();
  });

  it('merges tier and cohort in instances table: interpunct only when both set, else em dash when empty', () => {
    render(
      <InstanceListPanel
        instances={[
          {
            ...INSTANCE_FIXTURE,
            title: 'A',
            parentServiceTier: 'only-tier',
            cohort: null,
          },
          {
            ...INSTANCE_FIXTURE,
            id: 'instance-2',
            title: 'B',
            parentServiceTier: null,
            cohort: 'only-cohort',
          },
          {
            ...INSTANCE_FIXTURE,
            id: 'instance-3',
            title: 'C',
            parentServiceTier: 't1',
            cohort: 'c1',
          },
          {
            ...INSTANCE_FIXTURE,
            id: 'instance-4',
            title: 'D',
            parentServiceTier: null,
            cohort: null,
          },
        ]}
        expanded={makeExpanded()}
        draftDetail={null}
        renderDetail={() => null}
        isLoading={false}
        isLoadingMore={false}
        hasMore={false}
        error=''
        isMutating={false}
        onLoadMore={vi.fn()}
        onDuplicateInstance={vi.fn()}
        onDeleteInstance={vi.fn()}
        serviceFilter={{ value: '', options: [], onChange: vi.fn() }}
        serviceTypeFilter={{ value: '', onChange: vi.fn() }}
        statusFilter={{ value: '', onChange: vi.fn() }}
        searchFilter={{ value: '', onChange: vi.fn() }}
      />
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('Tier \u00b7 Cohort')).toBeInTheDocument();
    expect(within(table).getByText('only-tier')).toBeInTheDocument();
    expect(within(table).getByText('only-cohort')).toBeInTheDocument();
    expect(within(table).getByText('t1 \u00b7 c1')).toBeInTheDocument();

    const tierCohortColumnIndex = 2;
    const rowFor = (title: string) => {
      const titleCell = within(table).getByText(title);
      const row = titleCell.closest('tr');
      expect(row).toBeTruthy();
      return within(row as HTMLElement).getAllByRole('cell');
    };
    expect(rowFor('A')[tierCohortColumnIndex].textContent).toBe('only-tier');
    expect(rowFor('B')[tierCohortColumnIndex].textContent).toBe('only-cohort');
    expect(rowFor('C')[tierCohortColumnIndex].textContent).toBe('t1 \u00b7 c1');
    expect(rowFor('D')[tierCohortColumnIndex].textContent).toBe('\u2014');
  });

});
