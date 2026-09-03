import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InstanceListPanel } from '@/components/admin/services/instance-list-panel';
import { ServiceListPanel } from '@/components/admin/services/service-list-panel';
import type { ServiceInstance, ServiceSummary } from '@/types/services';

import { makeExpanded } from '../../../fixtures/expanded-record';

vi.mock('@/lib/clipboard', () => ({
  tryCopyTextToClipboard: vi.fn().mockResolvedValue(false),
}));

const SERVICE_ROW: ServiceSummary = {
  id: 'service-1',
  instancesCount: 0,
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

const INSTANCE_ROW: ServiceInstance = {
  id: 'instance-1',
  serviceId: 'service-1',
  parentServiceTitle: null,
  parentServiceTier: null,
  parentServiceType: null,
  parentServiceKey: null,
  title: null,
  slug: 'spring-cohort',
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
  cohort: null,
  notes: null,
  tagIds: [],
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  resolvedTitle: 'Spring cohort',
  resolvedSlug: 'spring-cohort',
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

describe('duplicate-as-draft feedback (services tables)', () => {
  it('shows brief success on service duplicate when handler returns true', async () => {
    vi.useFakeTimers();
    const onDuplicateService = vi.fn().mockResolvedValue(true);

    try {
      render(
        <ServiceListPanel
          services={[SERVICE_ROW]}
          filters={{ serviceType: '', status: '', search: '' }}
          isLoading={false}
          isLoadingMore={false}
          hasMore={false}
          error=''
          isMutating={false}
          expanded={makeExpanded()}
          draftDetail={null}
          renderDetail={() => null}
          onFilterChange={vi.fn()}
          onLoadMore={vi.fn()}
          onDuplicateService={onDuplicateService}
          onDeleteService={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Duplicate service as new draft' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draft copy ready' })).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duplicate service as new draft' })).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows brief success on instance duplicate when handler returns true', async () => {
    vi.useFakeTimers();
    const onDuplicateInstance = vi.fn().mockResolvedValue(true);

    try {
      render(
        <InstanceListPanel
          instances={[INSTANCE_ROW]}
          isLoading={false}
          isLoadingMore={false}
          hasMore={false}
          error=''
          isMutating={false}
          expanded={makeExpanded()}
          draftDetail={null}
          renderDetail={() => null}
          onLoadMore={vi.fn()}
          serviceFilter={{ value: '', options: [], onChange: vi.fn() }}
          serviceTypeFilter={{ value: '', onChange: vi.fn() }}
          statusFilter={{ value: '', onChange: vi.fn() }}
          searchFilter={{ value: '', onChange: vi.fn() }}
          onDuplicateInstance={onDuplicateInstance}
          onDeleteInstance={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Duplicate instance as new draft' }));

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Draft copy ready' })).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await vi.waitFor(() => {
        expect(screen.getByRole('button', { name: 'Duplicate instance as new draft' })).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
