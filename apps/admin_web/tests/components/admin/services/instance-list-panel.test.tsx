import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { InstanceListPanel } from '@/components/admin/services/instance-list-panel';
import { DRAFT_RECORD_ID } from '@/hooks/use-expanded-record';
import type { ServiceInstance } from '@/types/services';

import { makeExpanded } from '../../../fixtures/expanded-record';

const BASE_INSTANCE: ServiceInstance = {
  id: 'instance-1',
  serviceId: 'service-1',
  parentServiceTitle: 'Parent service',
  parentServiceTier: null,
  parentServiceType: null,
  parentServiceKey: null,
  title: null,
  slug: 'instance-one',
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
  createdBy: 'admin-sub',
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  resolvedTitle: 'Resolved title',
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

function renderPanel(overrides: Partial<ComponentProps<typeof InstanceListPanel>> = {}) {
  const props: ComponentProps<typeof InstanceListPanel> = {
    instances: [BASE_INSTANCE],
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: '',
    isMutating: false,
    onLoadMore: vi.fn(),
    expanded: makeExpanded(),
    draftDetail: <div data-testid='draft-editor'>draft editor</div>,
    renderDetail: (instance) => <div data-testid='row-editor'>editor for {instance.id}</div>,
    onDuplicateInstance: vi.fn(),
    onDeleteInstance: vi.fn().mockResolvedValue(undefined),
    serviceFilter: { value: '', options: [{ id: 'service-1', title: 'Parent service' }], onChange: vi.fn() },
    serviceTypeFilter: { value: '', onChange: vi.fn() },
    statusFilter: { value: 'not_completed', onChange: vi.fn() },
    searchFilter: { value: '', onChange: vi.fn() },
    ...overrides,
  };
  render(<InstanceListPanel {...props} />);
  return props;
}

describe('InstanceListPanel', () => {
  it('renders the table-first layout: filters, New instance, rows with Operations, no card title', () => {
    renderPanel();

    const region = screen.getByRole('region', { name: 'Instances' });
    const table = within(region).getByRole('table');
    expect(within(table).getByText('Parent service')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('button', { name: 'New instance' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search').parentElement).toHaveClass('sm:basis-[14.4rem]');
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Service')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate instance as new draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete instance' })).toBeInTheDocument();
    expect(screen.queryByTestId('row-editor')).toBeNull();
    expect(screen.queryByText('Booking')).toBeNull();
  });

  it('opens the draft row from New instance and renders the draft editor while it is open', () => {
    const expanded = makeExpanded();
    renderPanel({ expanded });
    fireEvent.click(screen.getByRole('button', { name: 'New instance' }));
    expect(expanded.openDraft).toHaveBeenCalledTimes(1);

    renderPanel({
      expanded: makeExpanded({ expandedId: DRAFT_RECORD_ID, isDraftOpen: true }),
      instances: [],
    });
    expect(screen.getByTestId('draft-editor')).toBeInTheDocument();
    expect(screen.getByText('New instance', { selector: 'td' })).toBeInTheDocument();
  });

  it('toggles a row through the shared expansion state and renders its editor in place', () => {
    const expanded = makeExpanded();
    renderPanel({ expanded });
    fireEvent.click(screen.getByRole('button', { name: /Parent service/ }));
    expect(expanded.toggle).toHaveBeenCalledWith('instance-1');

    renderPanel({
      expanded: makeExpanded({ expandedId: 'instance-1', isExpanded: (id) => id === 'instance-1' }),
    });
    expect(screen.getByTestId('row-editor')).toHaveTextContent('editor for instance-1');
  });

  it('pins an expanded instance hidden by the narrowing above the rows', () => {
    const pinned = { ...BASE_INSTANCE, id: 'instance-9', parentServiceTitle: 'Pinned service' };
    renderPanel({
      pinnedInstance: pinned,
      expanded: makeExpanded({ expandedId: 'instance-9', isExpanded: (id) => id === 'instance-9' }),
    });
    const rows = screen.getAllByRole('button', { name: /service/ });
    expect(rows[0]).toHaveAccessibleName(/Pinned service/);
    expect(screen.getByTestId('row-editor')).toHaveTextContent('editor for instance-9');
  });

  it('applies filter changes immediately', () => {
    const props = renderPanel();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'spring' } });
    expect(props.searchFilter.onChange).toHaveBeenCalledWith('spring');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
    expect(props.statusFilter.onChange).toHaveBeenCalledWith('completed');
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'service-1' } });
    expect(props.serviceFilter.onChange).toHaveBeenCalledWith('service-1');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'event' } });
    expect(props.serviceTypeFilter.onChange).toHaveBeenCalledWith('event');
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull();
  });

  it('confirms before deleting from the Operations column', async () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete instance' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await vi.waitFor(() => {
      expect(props.onDeleteInstance).toHaveBeenCalledWith('instance-1', 'service-1');
    });
  });

  it('shows capacity override badge when capacityLeftOverride is set', () => {
    renderPanel({
      instances: [
        {
          ...BASE_INSTANCE,
          maxCapacity: 10,
          capacityEnrolledCount: 2,
          capacityLeftOverride: 1,
          capacityLeftEffective: 1,
        },
      ],
    });

    expect(screen.getByText('1/10')).toBeInTheDocument();
    expect(screen.getByText('Override')).toBeInTheDocument();
  });
});
