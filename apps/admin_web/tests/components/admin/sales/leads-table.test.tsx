import { render, screen, within } from '@testing-library/react';
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
import type { UseExpandedRecordReturn } from '@/hooks/use-expanded-record';
import { DEFAULT_LEAD_LIST_FILTERS } from '@/types/leads';
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

function makeExpanded(overrides: Partial<UseExpandedRecordReturn> = {}): UseExpandedRecordReturn {
  return {
    expandedId: null,
    isDraftOpen: false,
    isExpanded: vi.fn(() => false),
    toggle: vi.fn(),
    expand: vi.fn(),
    openDraft: vi.fn(),
    collapse: vi.fn(),
    discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
    ...overrides,
  };
}

function renderComponent(overrides: Partial<ComponentProps<typeof LeadsTable>> = {}) {
  const onLoadMore = vi.fn().mockResolvedValue(undefined);
  const onFilterChange = vi.fn();
  const onBulkAssign = vi.fn().mockResolvedValue(undefined);
  const onBulkStageChange = vi.fn().mockResolvedValue(undefined);
  const renderDetail = vi.fn((lead: LeadSummary | null) => (
    <div data-testid='lead-detail'>{lead ? lead.id : 'new'}</div>
  ));
  const expanded = overrides.expanded ?? makeExpanded();

  render(
    <LeadsTable
      leads={[LEAD_FIXTURE]}
      filters={DEFAULT_LEAD_LIST_FILTERS}
      users={[]}
      expanded={expanded}
      isLoading={false}
      isLoadingMore={false}
      error=''
      hasMore={true}
      onLoadMore={onLoadMore}
      onFilterChange={onFilterChange}
      onBulkAssign={onBulkAssign}
      onBulkStageChange={onBulkStageChange}
      renderDetail={renderDetail}
      {...overrides}
    />
  );
  return { onLoadMore, onFilterChange, onBulkAssign, onBulkStageChange, renderDetail, expanded };
}

describe('LeadsTable', () => {
  it('renders a title-less card with filters, New lead, and expandable rows', async () => {
    const user = userEvent.setup();
    const { expanded, renderDetail } = renderComponent();
    const table = screen.getByRole('table');

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-record-table')).toBeInTheDocument();
    expect(screen.getByTestId('admin-filter-bar')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument();
    expect(table).not.toHaveTextContent('jane@example.com');
    expect(table).toHaveTextContent('Manual');
    expect(table).toHaveTextContent('New');
    expect(screen.getByRole('columnheader', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();

    const contactLink = screen.getByRole('link', { name: 'Open contact' });
    expect(contactLink).toHaveAttribute('href', '/contacts?contact=contact-1');
    expect(renderDetail).not.toHaveBeenCalled();

    await user.click(screen.getByText('Jane Doe'));
    expect(expanded.toggle).toHaveBeenCalledWith('lead-1');

    await user.click(screen.getByRole('button', { name: 'Expand Jane Doe' }));
    expect(expanded.toggle).toHaveBeenCalledTimes(2);

    vi.mocked(expanded.toggle).mockClear();
    await user.click(contactLink);
    expect(expanded.toggle).not.toHaveBeenCalled();
  });

  it('opens the draft row from New lead and mounts the editor for the open row', () => {
    const expanded = makeExpanded({
      expandedId: 'lead-1',
      isExpanded: vi.fn((id: string) => id === 'lead-1'),
    });
    const { renderDetail } = renderComponent({ expanded });

    expect(renderDetail).toHaveBeenCalledWith(LEAD_FIXTURE);
    expect(screen.getByTestId('lead-detail')).toHaveTextContent('lead-1');
    expect(screen.getByTestId('admin-row-lead-1')).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the draft row above the list when the draft is open', async () => {
    const user = userEvent.setup();
    const expanded = makeExpanded({ expandedId: 'new', isDraftOpen: true });
    const { renderDetail } = renderComponent({ expanded });

    const draftRow = screen.getByTestId('admin-row-new');
    expect(draftRow).toHaveAttribute('data-draft', 'true');
    expect(within(draftRow).getByText('New lead')).toBeInTheDocument();
    expect(renderDetail).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('lead-detail')).toHaveTextContent('new');

    const createButton = screen.getByRole('button', { name: 'New lead' });
    expect(createButton).toHaveAttribute('aria-pressed', 'true');
    await user.click(createButton);
    expect(expanded.collapse).toHaveBeenCalledTimes(1);
  });

  it('calls openDraft from New lead when nothing is open', async () => {
    const user = userEvent.setup();
    const { expanded } = renderComponent();

    await user.click(screen.getByRole('button', { name: 'New lead' }));
    expect(expanded.openDraft).toHaveBeenCalledTimes(1);
  });

  it('pins a deep-linked lead that is outside the loaded pages', () => {
    const pinned: LeadSummary = {
      ...LEAD_FIXTURE,
      id: 'lead-pinned',
      contact: { ...LEAD_FIXTURE.contact, id: 'contact-9', firstName: 'Pinned', lastName: 'Lead' },
    };
    renderComponent({ pinnedLead: pinned });

    const rows = screen.getAllByTestId(/^admin-row-lead-\w+$/);
    expect(rows[0]).toHaveTextContent('Pinned Lead');
    expect(rows[1]).toHaveTextContent('Jane Doe');
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

  it('shows the bulk toolbar once a row is checked and clears the selection after running', async () => {
    const user = userEvent.setup();
    const { onBulkStageChange, expanded } = renderComponent();

    expect(screen.queryByTestId('leads-bulk-actions')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select Jane Doe' }));
    expect(expanded.toggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('leads-bulk-actions')).toHaveTextContent('1 lead(s) selected');

    await user.selectOptions(screen.getByLabelText('Bulk set stage'), 'contacted');
    expect(onBulkStageChange).toHaveBeenCalledWith(['lead-1'], 'contacted', undefined);
    expect(screen.queryByTestId('leads-bulk-actions')).not.toBeInTheDocument();
  });
});
