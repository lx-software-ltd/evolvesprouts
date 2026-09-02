'use client';

import { useEffect, useMemo, useState } from 'react';

import { MAILCHIMP_PRODUCTION_GATE_MESSAGE, useMailchimpSync } from '@/hooks/use-mailchimp-sync';
import { AdminDisclosure } from '@/components/ui/admin-disclosure';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const TAG_NAME_REGEX = /^[a-zA-Z0-9 ._-]{1,100}$/;
const DEFAULT_TAG_NAME = 'crm-bulk-sync';
const MIN_MAX_CONTACTS = 1;
const MAX_MAX_CONTACTS = 200;
const MIN_MAX_MEMBERS = 1;
const MAX_MAX_MEMBERS = 1000;

function formatRelativeAgo(fromMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (sec < 10) {
    return 'just now';
  }
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 48) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function parseClampedInt(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return min;
  }
  return Math.min(Math.max(parsed, min), max);
}

function countFor(status: Record<string, number> | undefined, key: string): number {
  if (!status) {
    return 0;
  }
  const v = status[key];
  return typeof v === 'number' ? v : 0;
}

export function MailchimpSyncCard() {
  const {
    status,
    statusLoading,
    statusError,
    refetchStatus,
    productionGated,
    syncRun,
    startSyncRun,
    abortSyncRun,
    orphanRun,
    startOrphanRun,
    abortOrphanRun,
  } = useMailchimpSync();

  const [lastRefreshSnapshotMs, setLastRefreshSnapshotMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!status) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLastRefreshSnapshotMs(Date.now());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [tagName, setTagName] = useState(DEFAULT_TAG_NAME);
  const [maxContacts, setMaxContacts] = useState(100);
  const [pendingChecked, setPendingChecked] = useState(true);
  const [failedChecked, setFailedChecked] = useState(true);
  const [syncDryRun, setSyncDryRun] = useState(true);
  const [syncRunUsedDryRun, setSyncRunUsedDryRun] = useState(true);

  const [orphanMaxMembers, setOrphanMaxMembers] = useState(200);
  const [orphanMode, setOrphanMode] = useState<'archive' | 'permanent'>('archive');
  const [orphanDryRun, setOrphanDryRun] = useState(true);
  const [orphanRunUsedDryRun, setOrphanRunUsedDryRun] = useState(true);

  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [permanentConfirmOpen, setPermanentConfirmOpen] = useState(false);
  const [permanentConfirmInput, setPermanentConfirmInput] = useState('');

  const tagNameValid = TAG_NAME_REGEX.test(tagName.trim());
  const onlyStatuses = useMemo(() => {
    const list: ('pending' | 'failed')[] = [];
    if (pendingChecked) {
      list.push('pending');
    }
    if (failedChecked) {
      list.push('failed');
    }
    return list;
  }, [pendingChecked, failedChecked]);
  const statusesSelectionValid = onlyStatuses.length > 0;

  const relativeRefresh = useMemo(() => {
    if (lastRefreshSnapshotMs === null) {
      return '—';
    }
    return formatRelativeAgo(lastRefreshSnapshotMs, nowMs);
  }, [lastRefreshSnapshotMs, nowMs]);

  const gateNotice = (
    <p className='rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700'>
      {MAILCHIMP_PRODUCTION_GATE_MESSAGE}
    </p>
  );

  function handleSyncPrimaryClick() {
    if (syncRun.state === 'running') {
      abortSyncRun();
      return;
    }
    setSyncRunUsedDryRun(syncDryRun);
    void startSyncRun({
      tagName: tagName.trim(),
      maxContacts,
      onlyStatuses,
      dryRun: syncDryRun,
    });
  }

  function handleOrphanPrimaryClick() {
    if (orphanRun.state === 'running') {
      abortOrphanRun();
      return;
    }
    if (orphanDryRun) {
      setOrphanRunUsedDryRun(true);
      void startOrphanRun({
        maxMembers: orphanMaxMembers,
        mode: orphanMode,
        dryRun: true,
      });
      return;
    }
    if (orphanMode === 'archive') {
      setArchiveConfirmOpen(true);
      return;
    }
    setPermanentConfirmInput('');
    setPermanentConfirmOpen(true);
  }

  function confirmArchiveOrphanRun() {
    setArchiveConfirmOpen(false);
    setOrphanRunUsedDryRun(false);
    void startOrphanRun({
      maxMembers: orphanMaxMembers,
      mode: 'archive',
      dryRun: false,
    });
  }

  function confirmPermanentOrphanRun() {
    setPermanentConfirmOpen(false);
    setPermanentConfirmInput('');
    setOrphanRunUsedDryRun(false);
    void startOrphanRun({
      maxMembers: orphanMaxMembers,
      mode: 'permanent',
      dryRun: false,
    });
  }

  const syncPrimaryDisabled =
    syncRun.state !== 'running' &&
    (!tagNameValid || !statusesSelectionValid || statusLoading);

  const orphanPrimaryDisabled = orphanRun.state !== 'running' && statusLoading;

  const showSyncProgress = syncRun.state !== 'idle';
  const showOrphanProgress = orphanRun.state !== 'idle';

  return (
    <Card aria-label='Mailchimp sync' data-testid='mailchimp-sync-card'>
      <div className='space-y-4'>
        <div className='space-y-3'>
          {statusError ? (
            <div className='flex flex-wrap items-start justify-between gap-2' role='alert'>
              <p className='text-sm text-red-800'>{statusError}</p>
              <Button type='button' variant='secondary' size='sm' onClick={() => void refetchStatus()}>
                Retry
              </Button>
            </div>
          ) : null}
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6'>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Pending</div>
              <div className='text-lg font-semibold text-slate-900'>
                {countFor(status?.counts_by_status, 'pending')}
              </div>
            </div>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Synced</div>
              <div className='text-lg font-semibold text-slate-900'>
                {countFor(status?.counts_by_status, 'synced')}
              </div>
            </div>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Failed</div>
              <div className='text-lg font-semibold text-slate-900'>
                {countFor(status?.counts_by_status, 'failed')}
              </div>
            </div>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Unsubscribed</div>
              <div className='text-lg font-semibold text-slate-900'>
                {countFor(status?.counts_by_status, 'unsubscribed')}
              </div>
            </div>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Archived w/ MC record</div>
              <div className='text-lg font-semibold text-slate-900'>
                {status?.archived_with_mailchimp_record ?? 0}
              </div>
            </div>
            <div className='rounded-md border border-slate-200 bg-slate-50/80 p-2 text-center'>
              <div className='text-xs font-medium text-slate-600'>Last refreshed</div>
              <div className='text-lg font-semibold text-slate-900'>{relativeRefresh}</div>
            </div>
          </div>
        </div>

        <AdminDisclosure id='mailchimp-sync-push' title='Push CRM contacts to Mailchimp'>
          {productionGated ? (
            gateNotice
          ) : (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='mailchimp-sync-tag-name'>Tag name</Label>
                <Input
                  id='mailchimp-sync-tag-name'
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  autoComplete='off'
                />
                {!tagNameValid ? (
                  <p className='text-xs text-red-700'>
                    Use 1–100 characters: letters, numbers, spaces, dots, underscores, hyphens.
                  </p>
                ) : null}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='mailchimp-sync-max-contacts'>Batch size (1–200)</Label>
                <Input
                  id='mailchimp-sync-max-contacts'
                  type='number'
                  min={MIN_MAX_CONTACTS}
                  max={MAX_MAX_CONTACTS}
                  value={maxContacts}
                  onChange={(e) =>
                    setMaxContacts(parseClampedInt(e.target.value, MIN_MAX_CONTACTS, MAX_MAX_CONTACTS))
                  }
                />
              </div>
              <fieldset className='space-y-2'>
                <legend className='text-sm font-medium text-slate-800'>Statuses to push</legend>
                <div className='flex flex-wrap gap-4'>
                  <div className='flex items-center gap-2'>
                    <input
                      id='mailchimp-sync-status-pending'
                      type='checkbox'
                      checked={pendingChecked}
                      onChange={(e) => setPendingChecked(e.target.checked)}
                      className='h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500'
                    />
                    <Label
                      htmlFor='mailchimp-sync-status-pending'
                      className='mb-0 inline align-middle text-sm font-normal text-slate-800'
                    >
                      Pending
                    </Label>
                  </div>
                  <div className='flex items-center gap-2'>
                    <input
                      id='mailchimp-sync-status-failed'
                      type='checkbox'
                      checked={failedChecked}
                      onChange={(e) => setFailedChecked(e.target.checked)}
                      className='h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500'
                    />
                    <Label
                      htmlFor='mailchimp-sync-status-failed'
                      className='mb-0 inline align-middle text-sm font-normal text-slate-800'
                    >
                      Failed
                    </Label>
                  </div>
                </div>
              </fieldset>
              <div className='flex items-center gap-2'>
                <input
                  id='mailchimp-sync-dry-run'
                  type='checkbox'
                  checked={syncDryRun}
                  onChange={(e) => setSyncDryRun(e.target.checked)}
                  className='h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500'
                />
                <Label htmlFor='mailchimp-sync-dry-run' className='mb-0 inline align-middle text-sm font-normal text-slate-800'>
                  Dry run (default on)
                </Label>
              </div>
              <div>
                <Button
                  type='button'
                  variant={syncRun.state === 'running' ? 'secondary' : 'primary'}
                  disabled={syncPrimaryDisabled}
                  onClick={handleSyncPrimaryClick}
                >
                  {syncRun.state === 'running' ? 'Stop' : 'Run upsert batch'}
                </Button>
              </div>
              {showSyncProgress ? (
                <div className='space-y-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800'>
                  <div className='font-medium text-slate-900'>Progress</div>
                  <ul className='grid gap-1 sm:grid-cols-2'>
                    <li>batches: {syncRun.totals.batches}</li>
                    <li>processed: {syncRun.totals.processed}</li>
                    {syncRunUsedDryRun ? (
                      <li className='sm:col-span-2'>Would process: {syncRun.totals.wouldProcess}</li>
                    ) : (
                      <li>Succeeded: {syncRun.totals.succeeded}</li>
                    )}
                    <li>Failed: {syncRun.totals.failed}</li>
                    <li>Skipped: {syncRun.totals.skipped}</li>
                  </ul>
                  {syncRun.error ? (
                    <p className='text-sm text-red-800' role='alert'>
                      {syncRun.error}
                    </p>
                  ) : null}
                  {syncRun.totals.errorsSample.length > 0 ? (
                    <div className='space-y-1'>
                      <div className='text-xs font-semibold uppercase tracking-wide text-slate-600'>
                        Recent errors
                      </div>
                      <ul className='space-y-2 divide-y divide-slate-100'>
                        {syncRun.totals.errorsSample.map((row) => (
                          <li key={`${row.contact_id}-${row.lead_email_masked}-${row.reason}`} className='pt-2 first:pt-0'>
                            <div className='font-medium text-slate-900'>{row.lead_email_masked}</div>
                            <div className='text-xs text-slate-600'>
                              {row.contact_id.slice(0, 8)} · {row.reason}
                              {row.status != null ? ` · HTTP ${row.status}` : ''}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {syncRun.totals.errorsSampleExtra > 0 ? (
                        <p className='text-xs text-slate-600'>+{syncRun.totals.errorsSampleExtra} more</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </AdminDisclosure>

        <AdminDisclosure id='mailchimp-sync-orphans' title='Reconcile Mailchimp orphans'>
          {productionGated ? (
            gateNotice
          ) : (
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='mailchimp-orphan-max'>Batch size (1–1000)</Label>
                <Input
                  id='mailchimp-orphan-max'
                  type='number'
                  min={MIN_MAX_MEMBERS}
                  max={MAX_MAX_MEMBERS}
                  value={orphanMaxMembers}
                  onChange={(e) =>
                    setOrphanMaxMembers(parseClampedInt(e.target.value, MIN_MAX_MEMBERS, MAX_MAX_MEMBERS))
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='mailchimp-orphan-mode'>Mode</Label>
                <Select
                  id='mailchimp-orphan-mode'
                  value={orphanMode}
                  onChange={(e) => setOrphanMode(e.target.value as 'archive' | 'permanent')}
                >
                  <option value='archive'>archive</option>
                  <option value='permanent'>permanent</option>
                </Select>
              </div>
              <div className='flex items-center gap-2'>
                <input
                  id='mailchimp-orphan-dry-run'
                  type='checkbox'
                  checked={orphanDryRun}
                  onChange={(e) => setOrphanDryRun(e.target.checked)}
                  className='h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500'
                />
                <Label htmlFor='mailchimp-orphan-dry-run' className='mb-0 inline align-middle text-sm font-normal text-slate-800'>
                  Dry run (default on)
                </Label>
              </div>
              <div>
                <Button
                  type='button'
                  variant={orphanRun.state === 'running' ? 'secondary' : 'primary'}
                  disabled={orphanPrimaryDisabled}
                  onClick={handleOrphanPrimaryClick}
                >
                  {orphanRun.state === 'running' ? 'Stop' : 'Run orphan cleanup'}
                </Button>
              </div>
              {showOrphanProgress ? (
                <div className='space-y-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800'>
                  <div className='font-medium text-slate-900'>Progress</div>
                  <ul className='grid gap-1 sm:grid-cols-2'>
                    <li>batches: {orphanRun.totals.batches}</li>
                    <li>scanned: {orphanRun.totals.scanned}</li>
                    <li>kept: {orphanRun.totals.kept}</li>
                    <li>removed: {orphanRun.totals.removed}</li>
                    <li>failed: {orphanRun.totals.failed}</li>
                    {orphanRunUsedDryRun ? (
                      <li className='sm:col-span-2'>Would remove: {orphanRun.totals.wouldRemove}</li>
                    ) : null}
                    <li className='sm:col-span-2'>
                      Already archived (skipped): {orphanRun.totals.alreadyArchived}
                    </li>
                  </ul>
                  {orphanRun.error ? (
                    <p className='text-sm text-red-800' role='alert'>
                      {orphanRun.error}
                    </p>
                  ) : null}
                  {orphanRun.totals.removedSample.length > 0 ? (
                    <div className='space-y-1'>
                      <div className='text-xs font-semibold uppercase tracking-wide text-slate-600'>
                        Recent removals
                      </div>
                      <ul className='space-y-2 divide-y divide-slate-100'>
                        {orphanRun.totals.removedSample.map((row) => (
                          <li key={`${row.email}-${row.status}`} className='pt-2 first:pt-0'>
                            <div className='font-medium text-slate-900'>{row.email}</div>
                            <div className='text-xs text-slate-600'>{row.status}</div>
                          </li>
                        ))}
                      </ul>
                      {orphanRun.totals.removedSampleExtra > 0 ? (
                        <p className='text-xs text-slate-600'>+{orphanRun.totals.removedSampleExtra} more</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </AdminDisclosure>
      </div>

      <ConfirmDialog
        open={archiveConfirmOpen}
        title='Archive Mailchimp orphans'
        description='Archive members not found in CRM. Members can be unarchived by an administrator in Mailchimp.'
        variant='danger'
        confirmLabel='Archive'
        onCancel={() => setArchiveConfirmOpen(false)}
        onConfirm={confirmArchiveOrphanRun}
      />
      <ConfirmDialog
        open={permanentConfirmOpen}
        title='Permanent Mailchimp erase'
        description='Permanently erase members not found in CRM. This is irreversible. Type PERMANENT to confirm.'
        variant='danger'
        confirmLabel='Erase permanently'
        confirmDisabled={permanentConfirmInput !== 'PERMANENT'}
        onCancel={() => {
          setPermanentConfirmOpen(false);
          setPermanentConfirmInput('');
        }}
        onConfirm={confirmPermanentOrphanRun}
      >
        <div className='space-y-2'>
          <Label htmlFor='mailchimp-permanent-confirm'>Confirmation</Label>
          <Input
            id='mailchimp-permanent-confirm'
            value={permanentConfirmInput}
            onChange={(e) => setPermanentConfirmInput(e.target.value)}
            autoComplete='off'
            autoCapitalize='characters'
            autoCorrect='off'
          />
        </div>
      </ConfirmDialog>
    </Card>
  );
}
