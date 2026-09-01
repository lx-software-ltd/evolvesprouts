import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LeadsTable } from '@/components/admin/sales/leads-table';
import type { LeadSummary } from '@/types/leads';

const LEAD_FIXTURE: LeadSummary = {
  id: 'lead-1',
  contact: {
    id: 'contact-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phoneRegion: null,
    phoneNationalNumber: null,
    phoneE164: null,
    instagramHandle: null,
    source: 'manual',
    sourceDetail: null,
    contactType: 'parent',
    relationshipType: 'prospect',
  },
  leadType: 'consultation',
  funnelStage: 'new',
  assignedTo: null,
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
  convertedAt: null,
  lostAt: null,
  lostReason: null,
  daysInStage: 4,
  lastActivityAt: '2026-03-02T10:00:00Z',
  tags: [],
};

function renderComponent(overrides: Partial<ComponentProps<typeof LeadsTable>> = {}) {
  const onLoadMore = vi.fn().mockResolvedValue(undefined);
  const onSelectLead = vi.fn();
  const onFilterChange = vi.fn();
  const onBulkAssign = vi.fn().mockResolvedValue(undefined);
  const onBulkStageChange = vi.fn().mockResolvedValue(undefined);

  render(
    <LeadsTable
      leads={[LEAD_FIXTURE]}
      filters={{
        stage: [],
        source: [],
        leadType: [],
        assignedTo: null,
        unassigned: false,
        dateFrom: null,
        dateTo: null,
        search: '',
        sort: 'created_at',
        sortDir: 'desc',
      }}
      users={[]}
      selectedLeadId={null}
      isLoading={false}
      isLoadingMore={false}
      error=''
      hasMore={true}
      onLoadMore={onLoadMore}
      onSelectLead={onSelectLead}
      onFilterChange={onFilterChange}
      onBulkAssign={onBulkAssign}
      onBulkStageChange={onBulkStageChange}
      {...overrides}
    />
  );
  return { onLoadMore, onSelectLead, onFilterChange };
}

describe('LeadsTable', () => {
  it('renders lead data and supports row selection', async () => {
    const user = userEvent.setup();
    const { onSelectLead } = renderComponent();
    const table = screen.getByRole('table');

    expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ total$/)).not.toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(table).toHaveTextContent('Manual');
    expect(table).toHaveTextContent('New');
    expect(screen.queryByRole('columnheader', { name: 'Assigned' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open lead' })).not.toBeInTheDocument();
    const contactLink = screen.getByRole('link', { name: 'Open contact' });
    expect(contactLink).toHaveAttribute('href', '/contacts?contact=contact-1');
    expect(contactLink).toHaveClass('border-slate-300', 'bg-white', 'px-3');
    await user.click(screen.getByText('Jane Doe'));
    expect(onSelectLead).toHaveBeenCalledWith('lead-1');
    onSelectLead.mockClear();
    await user.click(screen.getByRole('link', { name: 'Open contact' }));
    expect(onSelectLead).not.toHaveBeenCalled();
  });

  it('loads more leads when load-more is clicked', async () => {
    const user = userEvent.setup();
    const { onLoadMore } = renderComponent();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('updates search filter on input change', async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderComponent();

    await user.type(screen.getByPlaceholderText('Search by name or email'), 'jane');
    expect(onFilterChange).toHaveBeenCalled();
  });
});
