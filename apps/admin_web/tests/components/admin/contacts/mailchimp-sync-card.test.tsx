import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError } from '@/lib/api-admin-client';
import { MAILCHIMP_PRODUCTION_GATE_MESSAGE } from '@/hooks/use-mailchimp-sync';

const { getMailchimpSyncStatus, runMailchimpSyncBatch, runMailchimpOrphanCleanup } = vi.hoisted(
  () => ({
    getMailchimpSyncStatus: vi.fn(),
    runMailchimpSyncBatch: vi.fn(),
    runMailchimpOrphanCleanup: vi.fn(),
  })
);

vi.mock('@/lib/mailchimp-sync-api', () => ({
  getMailchimpSyncStatus,
  runMailchimpSyncBatch,
  runMailchimpOrphanCleanup,
}));

import { MailchimpSyncCard } from '@/components/admin/contacts/mailchimp-sync-card';

const defaultStatus = {
  counts_by_status: { pending: 2, synced: 3, failed: 1, unsubscribed: 4 },
  archived_with_mailchimp_record: 5,
  last_run_summary: null,
};

function baseSyncResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    next_cursor: null,
    errors_sample: [],
    dry_run: false,
    would_process: 0,
    ...overrides,
  };
}

function baseOrphanResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    scanned: 0,
    kept: 0,
    removed: 0,
    failed: 0,
    next_offset: null,
    removed_sample: [],
    dry_run: false,
    would_remove: 0,
    already_archived: 0,
    ...overrides,
  };
}

describe('MailchimpSyncCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMailchimpSyncStatus.mockResolvedValue(defaultStatus);
    runMailchimpSyncBatch.mockResolvedValue(baseSyncResponse());
    runMailchimpOrphanCleanup.mockResolvedValue(baseOrphanResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an untitled white card with the six counter tiles and no Refresh button', async () => {
    render(<MailchimpSyncCard />);

    expect(await screen.findByTestId('mailchimp-sync-card')).toHaveClass('bg-white', 'border');
    expect(screen.queryByRole('heading', { name: 'Mailchimp sync' })).not.toBeInTheDocument();
    expect(screen.queryByText('Status snapshot')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Pending')[0].nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Synced').nextElementSibling).toHaveTextContent('3');
    expect(screen.getAllByText('Failed')[0].nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Unsubscribed').nextElementSibling).toHaveTextContent('4');
    expect(screen.getByText('Archived w/ MC record').nextElementSibling).toHaveTextContent('5');
    expect(screen.getByText('Last refreshed')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Last refreshed').nextElementSibling?.textContent).not.toBe('—');
    });
  });

  it('409 from runMailchimpSyncBatch shows the gate notice in action sections; status row stays', async () => {
    const user = userEvent.setup();
    runMailchimpSyncBatch.mockRejectedValue(
      new AdminApiError({
        statusCode: 409,
        payload: { detail: 'nope' },
        message: 'conflict',
      })
    );

    render(<MailchimpSyncCard />);
    await screen.findByTestId('mailchimp-sync-card');

    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));
    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    const notices = await screen.findAllByText(
      'Mailchimp bulk sync is only available in production. Counters above are read-only in this environment.'
    );
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pending')[0]).toBeInTheDocument();
  });

  it('only_statuses has exactly pending and failed checkboxes; submit disabled when both unchecked', async () => {
    const user = userEvent.setup();

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));

    const pushSection = screen.getByTestId('mailchimp-sync-push-disclosure');
    expect(pushSection.tagName).toBe('SECTION');
    const region = within(pushSection);

    expect(region.getByRole('checkbox', { name: 'Pending' })).toBeInTheDocument();
    expect(region.getByRole('checkbox', { name: 'Failed' })).toBeInTheDocument();
    expect(region.queryByRole('checkbox', { name: 'Synced' })).toBeNull();

    await user.click(region.getByRole('checkbox', { name: 'Pending' }));
    await user.click(region.getByRole('checkbox', { name: 'Failed' }));

    expect(screen.getByRole('button', { name: 'Run upsert batch' })).toBeDisabled();
  });

  it('sync run loops twice; second body includes cursor and tag_name crm-bulk-sync', async () => {
    const user = userEvent.setup();
    const cursor = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    runMailchimpSyncBatch
      .mockResolvedValueOnce(
        baseSyncResponse({
          next_cursor: cursor,
          processed: 1,
          would_process: 0,
        })
      )
      .mockResolvedValueOnce(
        baseSyncResponse({
          next_cursor: null,
          processed: 2,
          would_process: 0,
        })
      );

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));

    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    await waitFor(() => expect(runMailchimpSyncBatch).toHaveBeenCalledTimes(2));
    expect(runMailchimpSyncBatch.mock.calls[0][0]).not.toHaveProperty('cursor');
    expect(runMailchimpSyncBatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tag_name: 'crm-bulk-sync',
      }),
      expect.any(AbortSignal)
    );
    expect(runMailchimpSyncBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tag_name: 'crm-bulk-sync',
        cursor,
      }),
      expect.any(AbortSignal)
    );
  });

  it('dry-run sync shows Would process and hides Succeeded', async () => {
    const user = userEvent.setup();
    runMailchimpSyncBatch.mockResolvedValue(
      baseSyncResponse({
        dry_run: true,
        would_process: 7,
        succeeded: 99,
      })
    );

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));

    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    expect(await screen.findByText(/Would process: 7/)).toBeInTheDocument();
    expect(screen.queryByText(/Succeeded:/i)).toBeNull();
  });

  it('errors_sample shows lead_email_masked first', async () => {
    const user = userEvent.setup();
    runMailchimpSyncBatch.mockResolvedValue(
      baseSyncResponse({
        errors_sample: [
          {
            contact_id: '11111111-1111-1111-1111-111111111111',
            reason: 'mailchimp_api_error',
            status: 502,
            lead_email_masked: 'ab***@ex***.com',
          },
        ],
      })
    );

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));
    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    expect(await screen.findByText('ab***@ex***.com')).toBeInTheDocument();
  });

  it('orphan dry-run shows Would remove and Already archived (skipped) independently', async () => {
    const user = userEvent.setup();
    runMailchimpOrphanCleanup.mockResolvedValue(
      baseOrphanResponse({
        dry_run: true,
        would_remove: 11,
        already_archived: 4,
      })
    );

    render(<MailchimpSyncCard />);
    await screen.findByText('Reconcile Mailchimp orphans');
    await user.click(screen.getByText('Reconcile Mailchimp orphans'));
    await user.click(screen.getByRole('button', { name: 'Run orphan cleanup' }));

    expect(await screen.findByText(/Would remove: 11/)).toBeInTheDocument();
    expect(screen.getByText(/Already archived \(skipped\): 4/)).toBeInTheDocument();
  });

  it('orphan archive dry_run=false opens confirm and runs after accept', async () => {
    const user = userEvent.setup();

    render(<MailchimpSyncCard />);
    await screen.findByText('Reconcile Mailchimp orphans');
    await user.click(screen.getByText('Reconcile Mailchimp orphans'));

    const orphanRegion = within(screen.getByTestId('mailchimp-sync-orphans-disclosure'));
    await user.click(orphanRegion.getByLabelText(/Dry run/i));
    await user.click(orphanRegion.getByRole('button', { name: 'Run orphan cleanup' }));

    expect(await screen.findByRole('heading', { name: 'Archive Mailchimp orphans' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(runMailchimpOrphanCleanup).toHaveBeenCalled());
    expect(runMailchimpOrphanCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'archive', dry_run: false }),
      expect.any(AbortSignal)
    );
  });

  it('orphan permanent dry_run=false requires typing PERMANENT before destructive confirm', async () => {
    const user = userEvent.setup();

    render(<MailchimpSyncCard />);
    await screen.findByText('Reconcile Mailchimp orphans');
    await user.click(screen.getByText('Reconcile Mailchimp orphans'));

    const orphanRegion = within(screen.getByTestId('mailchimp-sync-orphans-disclosure'));
    await user.selectOptions(orphanRegion.getByLabelText('Mode'), 'permanent');
    await user.click(orphanRegion.getByLabelText(/Dry run/i));
    await user.click(orphanRegion.getByRole('button', { name: 'Run orphan cleanup' }));

    const dialog = await screen.findByRole('heading', { name: 'Permanent Mailchimp erase' });
    expect(dialog).toBeInTheDocument();

    const eraseBtn = screen.getByRole('button', { name: 'Erase permanently' });
    expect(eraseBtn).toBeDisabled();

    await user.type(screen.getByLabelText('Confirmation'), 'PERMANENT');
    expect(eraseBtn).not.toBeDisabled();
    await user.click(eraseBtn);

    await waitFor(() => expect(runMailchimpOrphanCleanup).toHaveBeenCalled());
    expect(runMailchimpOrphanCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'permanent', dry_run: false }),
      expect.any(AbortSignal)
    );
  });

  it('orphan loop passes server next_offset without client-side advancement', async () => {
    const user = userEvent.setup();
    runMailchimpOrphanCleanup
      .mockResolvedValueOnce(baseOrphanResponse({ next_offset: 0, removed: 1, scanned: 10 }))
      .mockResolvedValueOnce(baseOrphanResponse({ next_offset: 0, removed: 1, scanned: 10 }))
      .mockResolvedValueOnce(baseOrphanResponse({ next_offset: 0, removed: 1, scanned: 10 }))
      .mockResolvedValueOnce(baseOrphanResponse({ next_offset: null, removed: 0, scanned: 3 }));

    render(<MailchimpSyncCard />);
    await screen.findByText('Reconcile Mailchimp orphans');
    await user.click(screen.getByText('Reconcile Mailchimp orphans'));
    await user.click(screen.getByRole('button', { name: 'Run orphan cleanup' }));

    await waitFor(() => expect(runMailchimpOrphanCleanup).toHaveBeenCalledTimes(4));
    expect(runMailchimpOrphanCleanup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ mailchimp_offset: 0 }),
      expect.any(AbortSignal)
    );
    expect(runMailchimpOrphanCleanup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ mailchimp_offset: 0 }),
      expect.any(AbortSignal)
    );
    expect(runMailchimpOrphanCleanup).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ mailchimp_offset: 0 }),
      expect.any(AbortSignal)
    );
    expect(runMailchimpOrphanCleanup).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ mailchimp_offset: 0 }),
      expect.any(AbortSignal)
    );
  });

  it('abort prevents the next sync batch call', async () => {
    const user = userEvent.setup();
    runMailchimpSyncBatch.mockImplementation((_req, signal) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort);
      });
    });

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));
    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    await waitFor(() => expect(runMailchimpSyncBatch).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => {
      expect(runMailchimpSyncBatch).toHaveBeenCalledTimes(1);
    });
  });

  it('after a successful sync run, getMailchimpSyncStatus is called once more', async () => {
    const user = userEvent.setup();

    render(<MailchimpSyncCard />);
    await waitFor(() => expect(getMailchimpSyncStatus).toHaveBeenCalledTimes(1));

    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));
    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    await waitFor(() => expect(getMailchimpSyncStatus).toHaveBeenCalledTimes(2));
  });

  it('Last refreshed advances after timer tick (fake timers)', async () => {
    vi.useFakeTimers();
    const start = new Date('2025-06-01T12:00:00.000Z').getTime();
    vi.setSystemTime(start);

    render(<MailchimpSyncCard />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Last refreshed').nextElementSibling).toHaveTextContent('just now');

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    const label = screen.getByText('Last refreshed').nextElementSibling?.textContent ?? '';
    expect(label).not.toBe('just now');
    expect(label).toMatch(/\d+s ago/);
  });

  it('409 on sync keeps the production gate notice in both sections while counters stay visible', async () => {
    const user = userEvent.setup();
    runMailchimpSyncBatch.mockRejectedValueOnce(
      new AdminApiError({
        statusCode: 409,
        payload: { detail: 'nope' },
        message: 'conflict',
      })
    );

    render(<MailchimpSyncCard />);
    await screen.findByTestId('mailchimp-sync-card');

    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));
    await user.click(screen.getByRole('button', { name: 'Run upsert batch' }));

    await waitFor(() => {
      expect(screen.getAllByText(MAILCHIMP_PRODUCTION_GATE_MESSAGE).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByLabelText('Tag name')).not.toBeInTheDocument();
    expect(screen.getAllByText('Pending')[0]).toBeInTheDocument();
  });

  it('clamps max_contacts input to 200 and max_members to 1000', async () => {
    const user = userEvent.setup();

    render(<MailchimpSyncCard />);
    await screen.findByText('Push CRM contacts to Mailchimp');
    await user.click(screen.getByText('Push CRM contacts to Mailchimp'));

    const syncBatch = screen.getByLabelText(/Batch size \(1–200\)/);
    await user.clear(syncBatch);
    await user.type(syncBatch, '9999');
    expect(syncBatch).toHaveValue(200);

    await user.click(screen.getByText('Reconcile Mailchimp orphans'));
    const orphanBatch = screen.getByLabelText(/Batch size \(1–1000\)/);
    await user.clear(orphanBatch);
    await user.type(orphanBatch, '5000');
    expect(orphanBatch).toHaveValue(1000);
  });
});
