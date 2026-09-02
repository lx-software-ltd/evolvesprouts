import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsPage } from '@/components/admin/contacts/contacts-page';
import { resetAdminQueryClientForTests } from '@/lib/admin-query-client';

const listEntityTags = vi.fn();
const listAllLocations = vi.fn();
const listGeographicAreas = vi.fn();

vi.mock('@/lib/entity-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/entity-api')>();
  return {
    ...actual,
    listEntityTags: (...args: unknown[]) => listEntityTags(...args),
  };
});

vi.mock('@/lib/services-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services-api')>();
  return {
    ...actual,
    listAllLocations: (...args: unknown[]) => listAllLocations(...args),
    listGeographicAreas: (...args: unknown[]) => listGeographicAreas(...args),
  };
});

const defaultContactsHook = {
  contacts: [],
  filters: { query: '', active: 'true' as const, contact_type: '' as const },
  setFilter: vi.fn(),
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: '',
  loadMore: vi.fn(),
  totalCount: 0,
  isSaving: false,
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
  patchContactStandaloneNoteCount: vi.fn(),
  refetch: vi.fn(),
};

const defaultFamiliesHook = {
  families: [],
  filters: { query: '', active: 'true' as const },
  setFilter: vi.fn(),
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: '',
  loadMore: vi.fn(),
  totalCount: 0,
  isSaving: false,
  createFamily: vi.fn(),
  updateFamily: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  refetch: vi.fn(),
};

const defaultOrgsHook = {
  organizations: [],
  filters: { query: '', active: 'true' as const },
  setFilter: vi.fn(),
  isLoading: false,
  isLoadingMore: false,
  hasMore: false,
  error: '',
  loadMore: vi.fn(),
  totalCount: 0,
  isSaving: false,
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  refetch: vi.fn(),
  relationshipOptions: ['prospect', 'client', 'partner', 'other'] as const,
};

vi.mock('@/hooks/use-admin-entity-contacts', () => ({
  useAdminEntityContacts: () => defaultContactsHook,
}));

vi.mock('@/hooks/use-admin-entity-families', () => ({
  useAdminEntityFamilies: () => defaultFamiliesHook,
}));

vi.mock('@/hooks/use-admin-entity-organizations', () => ({
  useAdminEntityOrganizations: () => defaultOrgsHook,
}));

vi.mock('@/hooks/use-admin-users', () => ({
  useAdminUsers: () => ({ users: [], isLoading: false, error: '', refetch: vi.fn() }),
}));

vi.mock('@/lib/mailchimp-sync-api', () => ({
  getMailchimpSyncStatus: vi.fn().mockResolvedValue({
    counts_by_status: { pending: 0, synced: 0, failed: 0, unsubscribed: 0 },
    archived_with_mailchimp_record: 0,
    last_run_summary: null,
  }),
  runMailchimpSyncBatch: vi.fn(),
  runMailchimpOrphanCleanup: vi.fn(),
}));

describe('ContactsPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/contacts');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/contacts');
    resetAdminQueryClientForTests();
    vi.clearAllMocks();
  });

  it('loads tags and locations on mount', async () => {
    listEntityTags.mockResolvedValue([]);
    listAllLocations.mockResolvedValue([]);
    listGeographicAreas.mockResolvedValue([]);

    render(<ContactsPage />);

    await waitFor(() => {
      expect(listEntityTags).toHaveBeenCalled();
    });
    expect(listAllLocations).toHaveBeenCalled();
    expect(listGeographicAreas).toHaveBeenCalled();
  });

  it('switches sub-views with the tab strip', async () => {
    const user = userEvent.setup();
    listEntityTags.mockResolvedValue([]);
    listAllLocations.mockResolvedValue([]);
    listGeographicAreas.mockResolvedValue([]);

    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Contact' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Families' }));
    expect(screen.getByRole('heading', { name: 'Families' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=families');

    await user.click(screen.getByRole('button', { name: 'Organisations' }));
    expect(screen.getByRole('heading', { name: 'Organisations' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=organizations');

    await user.click(screen.getByRole('button', { name: 'Mailchimp' }));
    expect(screen.getByRole('heading', { name: 'Mailchimp sync' })).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=mailchimp');
    expect(screen.queryByRole('heading', { name: 'Contact' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Contacts' }));
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('heading', { name: 'Mailchimp sync' })).not.toBeInTheDocument();
  });

  it('seeds the active sub-view from the URL query parameter on mount', async () => {
    listEntityTags.mockResolvedValue([]);
    listAllLocations.mockResolvedValue([]);
    listGeographicAreas.mockResolvedValue([]);

    window.history.replaceState(null, '', '/contacts?tab=organizations');
    render(<ContactsPage />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Organisations' })
      ).toBeInTheDocument();
    });
  });

  it('opens the Mailchimp tab from the URL query parameter', async () => {
    listEntityTags.mockResolvedValue([]);
    listAllLocations.mockResolvedValue([]);
    listGeographicAreas.mockResolvedValue([]);

    window.history.replaceState(null, '', '/contacts?tab=mailchimp');
    render(<ContactsPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Mailchimp sync' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'Contact' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mailchimp' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
