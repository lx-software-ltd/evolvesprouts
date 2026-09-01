import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

import { SalesPage } from '@/components/admin/sales/sales-page';

describe('SalesPage', () => {
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

  it('starts inline create-lead flow from header', async () => {
    const user = userEvent.setup();
    render(<SalesPage />);

    await user.click(screen.getAllByRole('button', { name: 'New lead' })[0]);
    expect(state.startCreateLead).toHaveBeenCalledTimes(1);
  });
});
