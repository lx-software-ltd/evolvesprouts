import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesView } from '@/hooks/use-sales-page';

const { mockUseSalesPage, state } = vi.hoisted(() => {
  const state = {
    activeView: 'pipeline' as SalesView,
    setActiveView: vi.fn(),
    selectedLeadId: null as string | null,
    setSelectedLeadId: vi.fn(),
    selectedLead: null,
    isCreateMode: false,
    startCreateLead: vi.fn(),
    cancelCreateLead: vi.fn(),
    adminUsers: {
      users: [],
      isLoading: false,
      error: '',
      refetch: vi.fn().mockResolvedValue(undefined),
    },
    leadList: {
      leads: [],
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
    state.isCreateMode = true;
    state.selectedLeadId = null;
    state.startCreateLead.mockClear();
    state.setActiveView.mockClear();
  });

  it('renders tabs and triggers view switch', async () => {
    const user = userEvent.setup();
    render(<SalesPage />);

    expect(screen.getByRole('button', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Messenger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Analytics' }));
    expect(state.setActiveView).toHaveBeenCalledWith('analytics');
  });

  it('keeps KPI cards and date filters off the pipeline tab', () => {
    state.activeView = 'pipeline';
    state.isCreateMode = true;
    render(<SalesPage />);

    expect(screen.queryByText('Total leads')).not.toBeInTheDocument();
    expect(screen.queryByText('0 total')).not.toBeInTheDocument();
    expect(screen.queryByText('Source Breakdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date range preset')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('First name *')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create lead' })).toBeInTheDocument();
  });

  it('shows inbox import controls on Instagram and WhatsApp views', () => {
    state.activeView = 'instagram';
    const { rerender } = render(<SalesPage />);
    expect(screen.getByRole('button', { name: 'Import recent history' })).toBeInTheDocument();

    state.activeView = 'whatsapp';
    rerender(<SalesPage />);
    expect(screen.getByText('Import WhatsApp export')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import export' })).toBeDisabled();

    state.activeView = 'pipeline';
  });

  it('starts inline create-lead flow from the existing-lead editor', async () => {
    const user = userEvent.setup();
    state.activeView = 'pipeline';
    state.isCreateMode = false;
    render(<SalesPage />);

    await user.click(screen.getByRole('button', { name: 'New lead' }));
    expect(state.startCreateLead).toHaveBeenCalledTimes(1);
  });

  it('moves KPI cards, funnel, source breakdown, and date filters to analytics', async () => {
    state.activeView = 'analytics';
    render(<SalesPage />);

    expect(screen.getByRole('heading', { name: 'Sales Analytics' })).toBeInTheDocument();
    expect(screen.getByLabelText('Date range preset')).toBeInTheDocument();
    expect(await screen.findByText('Total leads')).toBeInTheDocument();
    expect(screen.getByText('Conversion rate')).toBeInTheDocument();
    expect(screen.getByText('Avg. days to convert')).toBeInTheDocument();
    expect(screen.getByText('New this week')).toBeInTheDocument();
    expect(screen.getByText('Funnel')).toBeInTheDocument();
    expect(screen.getByText('Source Breakdown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument();

    state.activeView = 'pipeline';
  });
});
