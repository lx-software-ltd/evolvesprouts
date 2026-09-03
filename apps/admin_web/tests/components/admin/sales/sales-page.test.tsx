import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesView } from '@/hooks/use-sales-page';
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

const { mockUseSalesPage, state } = vi.hoisted(() => {
  const state = {
    activeView: 'pipeline' as SalesView,
    setActiveView: vi.fn(),
    expanded: {
      expandedId: null as string | null,
      isDraftOpen: false,
      isExpanded: vi.fn((id: string) => state.expanded.expandedId === id),
      toggle: vi.fn(),
      expand: vi.fn(),
      openDraft: vi.fn(),
      collapse: vi.fn(),
      discardPrompt: { open: false, confirm: vi.fn(), cancel: vi.fn() },
    },
    setEditorDirty: vi.fn(),
    selectedLeadId: null as string | null,
    selectedLead: null as LeadSummary | null,
    pinnedLead: null as LeadSummary | null,
    createLead: vi.fn().mockResolvedValue(null),
    adminUsers: {
      users: [],
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    salesSettings: {
      settings: {
        default_assigned_to: null,
        notify_assignee_on_assignment: false,
        helper_detector_enabled: false,
      },
      isLoading: false,
      isSaving: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    },
    leadList: {
      leads: [] as LeadSummary[],
      filters: {
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
      },
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
    leadDetail: {
      lead: null,
      events: [],
      notes: [],
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    leadAnalytics: {
      analytics: null,
      dateRange: { dateFrom: null, dateTo: null },
      setDateRange: vi.fn(),
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    mutations: {
      isLoading: false,
      error: '',
      createLeadEntry: vi.fn().mockResolvedValue(null),
      updateLeadEntry: vi.fn().mockResolvedValue(null),
      updateStage: vi.fn().mockResolvedValue(null),
      assignLead: vi.fn().mockResolvedValue(null),
      addNote: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    state,
    mockUseSalesPage: vi.fn(() => state),
  };
});

vi.mock('@/hooks/use-sales-page', () => ({
  useSalesPage: mockUseSalesPage,
}));

vi.mock('@/lib/inbox-import-api', () => ({
  listInboxImportJobs: vi.fn(async () => []),
  createMetaImportJob: vi.fn(),
  createWhatsAppExportImportJob: vi.fn(),
  formatInboxImportCounters: vi.fn(() => ''),
}));

vi.mock('@/hooks/use-whatsapp-conversations', () => ({
  useWhatsAppConversations: () => ({
    conversations: [],
    filters: { q: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 0,
  }),
}));

vi.mock('@/hooks/use-meta-conversations', () => ({
  useMetaConversations: () => ({
    conversations: [],
    filters: { q: '' },
    setFilter: vi.fn(),
    isLoading: false,
    isLoadingMore: false,
    error: '',
    refetch: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    totalCount: 0,
  }),
}));

vi.mock('@/hooks/use-whatsapp-messages', () => ({
  useWhatsAppMessages: () => ({
    conversation: null,
    messages: [],
    isLoading: false,
    error: '',
  }),
}));

vi.mock('@/hooks/use-meta-messages', () => ({
  useMetaMessages: () => ({
    conversation: null,
    messages: [],
    isLoading: false,
    error: '',
  }),
}));

vi.mock('@/components/admin/sales/funnel-chart', () => ({
  FunnelChart: () => <div>Funnel</div>,
}));

vi.mock('@/components/admin/sales/source-breakdown', () => ({
  SourceBreakdown: () => <div>Source Breakdown</div>,
}));

vi.mock('@/components/admin/sales/conversion-funnel', () => ({
  ConversionFunnel: () => <div>Conversion Funnel</div>,
}));

vi.mock('@/components/admin/sales/leads-over-time', () => ({
  LeadsOverTime: () => <div>Leads Over Time</div>,
}));

vi.mock('@/components/admin/sales/time-in-stage', () => ({
  TimeInStage: () => <div>Time in Stage</div>,
}));

import { SalesPage } from '@/components/admin/sales/sales-page';

describe('SalesPage', () => {
  beforeEach(() => {
    state.activeView = 'pipeline';
    state.expanded.expandedId = null;
    state.expanded.isDraftOpen = false;
    state.leadList.leads = [];
    state.selectedLeadId = null;
    state.selectedLead = null;
    state.setActiveView.mockClear();
    state.expanded.openDraft.mockClear();
    state.createLead.mockClear();
    state.mutations.updateLeadEntry.mockClear();
  });

  it('renders tabs and triggers view switch', async () => {
    const user = userEvent.setup();
    render(<SalesPage />);

    expect(screen.getByRole('button', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Messenger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(state.setActiveView).toHaveBeenCalledWith('analytics');
  });

  it('renders the pipeline as a title-less table with New lead and no analytics widgets', async () => {
    const user = userEvent.setup();
    render(<SalesPage />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText('Total leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Source Breakdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date range preset')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^First name/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New lead' }));
    expect(state.expanded.openDraft).toHaveBeenCalledTimes(1);
  });

  it('mounts the create editor in the draft row and forwards create to the page hook', async () => {
    const user = userEvent.setup();
    state.expanded.expandedId = 'new';
    state.expanded.isDraftOpen = true;
    render(<SalesPage />);

    expect(screen.getByTestId('admin-row-new')).toHaveAttribute('data-draft', 'true');
    expect(screen.getByLabelText(/^First name/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/^First name/), 'Sam');
    await user.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(state.createLead).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'Sam' }));
  });

  it('mounts the edit editor beneath the expanded lead row', async () => {
    const user = userEvent.setup();
    state.leadList.leads = [LEAD_FIXTURE];
    state.expanded.expandedId = 'lead-1';
    state.selectedLeadId = 'lead-1';
    state.selectedLead = LEAD_FIXTURE;
    render(<SalesPage />);

    expect(screen.getByTestId('admin-row-lead-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(/^First name/)).toHaveValue('Jane');
    expect(screen.getByLabelText('Stage')).toHaveValue('new');

    await user.selectOptions(screen.getByLabelText('Stage'), 'contacted');
    await user.click(screen.getByRole('button', { name: 'Update lead' }));
    expect(state.mutations.updateLeadEntry).toHaveBeenCalledWith(
      'lead-1',
      expect.objectContaining({ funnel_stage: 'contacted' })
    );
  });

  it('shows inbox import controls on Instagram and WhatsApp views', () => {
    state.activeView = 'instagram';
    const { rerender } = render(<SalesPage />);
    expect(screen.getByRole('button', { name: 'Import recent history' })).toBeInTheDocument();

    state.activeView = 'whatsapp';
    rerender(<SalesPage />);
    expect(screen.getByRole('button', { name: 'Import WhatsApp export' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Import export', hidden: true })).toBeDisabled();
  });

  it('renders the configuration as a title-less card on the configuration tab', () => {
    state.activeView = 'configuration';
    render(<SalesPage />);

    expect(screen.queryByRole('heading', { name: 'Sales configuration' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sales configuration' })).toBeInTheDocument();
    expect(screen.getByLabelText('Default assignee')).toBeInTheDocument();
    expect(screen.getByLabelText('Email the assignee when a lead is assigned to them')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('moves KPI cards, funnel, source breakdown, and date filters to analytics without a title or Refresh', async () => {
    state.activeView = 'analytics';
    render(<SalesPage />);

    expect(screen.queryByRole('heading', { name: 'Sales Analytics' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Analytics filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Date range preset')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(await screen.findByText('Total leads')).toBeInTheDocument();
    expect(screen.getByText('Conversion rate')).toBeInTheDocument();
    expect(screen.getByText('Avg. days to convert')).toBeInTheDocument();
    expect(screen.getByText('New this week')).toBeInTheDocument();
    expect(screen.getByText('Funnel')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument();
  });
});
